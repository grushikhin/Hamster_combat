const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');

const csvDataAuth = fs.readFileSync('authorization.csv', 'utf8');
const authorizationList = csvDataAuth.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.includes('#'));
const dailyUpgrades = fs.readFileSync('Upgrades.csv', 'utf8');
const dailyUpgradesList = dailyUpgrades.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('*'))
    .map(line => line.replace('*', '').trim());

const maxPrice = 2_000_000;
const comboCondition = 1_500_000;
const paybackInDaysLimit = 14;
const profitabilityLimit = 0.0031; // 13 days
const bulkSize = 5;

const csvDataProxy = fs.readFileSync('proxy.csv', 'utf8');
const proxyList = csvDataProxy.split('\n').map(line => line.trim()).filter(line => line !== '');

function shouldBuy(upgrade) {
    return upgrade.price < maxPrice &&
    upgrade.profitability >= profitabilityLimit &&
    upgrade.paybackInDays <= paybackInDaysLimit;
}

function createAxiosInstance(proxy) {
    const proxyAgent = new HttpsProxyAgent(proxy);
    return axios.create({
        baseURL: 'https://api.hamsterkombat.io',
        timeout: 10000,
        headers: {
            'Content-Type': 'application/json'
        },
        httpsAgent: proxyAgent
    });
}

async function checkProxyIP(proxy) {
    try {
        const proxyAgent = new HttpsProxyAgent(proxy);
        const response = await axios.get('https://api.ipify.org?format=json', {
            httpsAgent: proxyAgent 
        });
        if (response.status === 200) {
            console.log('Proxy IP address:', response.data.ip);
        } else {
            console.error('Unable to check proxy IP. Status code:', response.status);
        }
    } catch (error) {
        console.error('Error checking proxy IP:', error);
    }
}

async function getBalanceCoins(httpClient, account) {
    const { authorization, name } = account;
    try {
        const response = await httpClient.post('/clicker/sync', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            return response.data.clickerUser.balanceCoins;
        } else {
            console.error(`[${name}] Failed to retrieve balanceCoins information. Status code:`, response.status);
            return null;
        }
    } catch (error) {
        console.error(`[${name}] Error:`, error);
        return null;
    }
}

function logUpgrades(accountName, upgrades) {
    console.log(`[${accountName}] Available upgrades:`);
    console.table(upgrades.map(it => {
        const { name, profitability, price, profitPerHourDelta, paybackInDays } = it;
        return {
            name,
            paybackInDays: paybackInDays.toFixed(1),
            profitability: profitability.toFixed(4),
            price: price.toLocaleString('en-US') + '$',
            profitPerHourDelta:  profitPerHourDelta.toLocaleString('en-US') + '$'
        };
    }))
}
function logUpgrade(accountName, balanceCoins, upgrade) {
    console.log(`[${accountName}] (${Math.floor(balanceCoins).toLocaleString('en-US')}$ +${upgrade.profitPerHourDelta.toLocaleString('en-US')}$) Upgraded ${upgrade.name} to level ${upgrade.level + 1} by ${upgrade.price.toLocaleString('en-US')}$ with payback in ${upgrade.paybackInDays}.`);

}

async function buyUpgrades(httpClient, account) {
    const { authorization, name } = account;
    try {
        const upgrades = await getAvailableUpgrades(httpClient, account);

        let balanceCoins = await getBalanceCoins(httpClient, account);
        let purchased = false;

        logUpgrades(name, upgrades);

        for (const [index, upgrade] of upgrades.entries()) {
            if (index >= bulkSize) return purchased;
            if (upgrade.cooldownSeconds > 0) {
                console.log(`[${name}] Upgrade ${upgrade.name} is in cooldown for ${upgrade.cooldownSeconds} seconds.`);
                continue; 
            }

            if (upgrade.price <= balanceCoins && shouldBuy(upgrade)) {
                const buyUpgradePayload = {
                    upgradeId: upgrade.id,
                    timestamp: Math.floor(Date.now() / 1000)
                };
                try {
                    await httpClient.post('/clicker/buy-upgrade', buyUpgradePayload, {
                        headers: {
                            'Authorization': `Bearer ${authorization}`
                        }
                    });
                    logUpgrade(name, balanceCoins, upgrade);
                    purchased = true;
                    balanceCoins -= upgrade.price; 
                } catch (error) {
                    if (error.response && error.response.data && error.response.data.error_code === 'UPGRADE_COOLDOWN') {
                        console.log(`[${name}] Upgrade ${upgrade.name} is in cooldown for ${error.response.data.cooldownSeconds} seconds.`);
                        continue; 
                    } else {
                        throw error;
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000)); 
            }
        }

        if (!purchased) {
            console.log(`[${name}] Does not have any available or eligible upgrades. Moving to the next account.`);
            return false;
        }
        
    } catch (error) {
        console.error(`[${name}] Unexpected error, moving to the next token`, error);
        return false;
    }
    return true;
}

async function getAvailableUpgrades(httpClient, { authorization, name }) {
    try {
        const upgradesResponse = await httpClient.post('/clicker/upgrades-for-buy', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        const upgrades = upgradesResponse.data.upgradesForBuy
            .filter(it => it.isAvailable && !it.isExpired)
            .map(it => ({
            ...it,
            profitability: it.profitPerHourDelta / it.price,
            paybackInDays: it.price / it.profitPerHourDelta / 24
        })).sort((a, b) => b.profitability - a.profitability);

        return upgrades;
    } catch (error) {
        console.error(`[${name}] Failed to retrieve upgrade list. Error:`, error);
        throw error;
    }
}

async function buyComboUpgrades(httpClient, account) {
    const { authorization, name } = account;
    console.log(`[${name}] checking combo upgrades ${dailyUpgradesList}`)
    try {
        const upgrades = (await getAvailableUpgrades(httpClient, account)).filter(it => dailyUpgradesList.includes(it.name) && !it.cooldownSeconds);
            if (upgrades.length !== 3) {
                console.error(`[${name}] don't have 3 daily upgrades`, upgrades);
                return;
            }

            let balanceCoins = await getBalanceCoins(httpClient, account);
            let purchased = false;

            for (const upgrade of upgrades) {
                if (upgrade.price < comboCondition && upgrade.price <= balanceCoins) {
                    const buyUpgradePayload = {
                        upgradeId: upgrade.id,
                        timestamp: Math.floor(Date.now() / 1000)
                    };
                    await httpClient.post('/clicker/buy-upgrade', buyUpgradePayload, {
                        headers: {
                            'Authorization': `Bearer ${authorization}`
                        }
                    });

                    logUpgrade(name, balanceCoins, upgrade);
                    purchased = true;
                    balanceCoins -= upgrade.price;
                    
                    await new Promise(resolve => setTimeout(resolve, 1000)); 
                }
            }

            if (purchased) {
                await httpClient.post('/clicker/claim-daily-combo', {}, {
                    headers: {
                        'Authorization': `Bearer ${authorization}`
                    }
                });
                return;
            }

            console.log(`[${name}] Does not have any available or eligible upgrades. Moving to the next account.`);

    } catch (error) {
        console.error(`[${name}] Unexpected error buying daily combo`, error);
    }
}

async function claimDailyCipher(httpClient, { authorization, name }, cipher) {
    if (cipher) {
        try {
            const payload = { cipher };
            const response = await httpClient.post('/clicker/claim-daily-cipher', payload, {
                headers: {
                    'Authorization': `Bearer ${authorization}`
                }
            });

            if (response.status === 200) {
                console.log(`[${name}] Decoded morse ${cipher} for ${name}`);
            } else {
                console.error(`[${name}] Failed to claim daily cipher. Status code:`, response.status);
            }
        } catch (error) {
            console.error(`[${name}] Error:`, error.message || error);
        }
    }
}

async function askForUpgrade() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Upgrade any cards? (y/n): ', (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}


async function askForCombo() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question(`Upgrade Daily Combo? (${dailyUpgradesList.join(' | ')}) (y/n): `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === 'y');
        });
    });
}

async function askForCipher() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Morse code to decode today: ', (answer) => {
            rl.close();
            resolve(answer.trim().toUpperCase());
        });
    });
}

async function main() {
    const shouldUpgrade = await askForUpgrade(); 
    const cipher = await askForCipher();
    const buyCombo = await askForCombo();

    for (let i = 0; i < authorizationList.length; i++) {
        const authorization = authorizationList[i];
        const [token, name] = authorization.split(':');
        const proxy = proxyList[i % proxyList.length];
        const account = {
            authorization: token,
            name: name || `Acc${i + 1}`
        };

        await checkProxyIP(proxy);

        const httpClient = createAxiosInstance(proxy);

        if (cipher) {
            await claimDailyCipher(httpClient, account, cipher);
        }
        if (buyCombo) {
            await buyComboUpgrades(httpClient, account);
        }

        if (shouldUpgrade) { 
            while (true) {
                const success = await buyUpgrades(httpClient, account);
                if (!success) {
                    break;
                }
            }
        }
        console.log('---------------------------');
    }
    console.log('All tokens have been processed.');
}

main();


