const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');

const csvDataAuth = fs.readFileSync('authorization.csv', 'utf8');
const authorizationList = csvDataAuth.split('\n').map(line => line.trim()).filter(line => line !== '');
const dailyUpgrades = fs.readFileSync('Upgrades.csv', 'utf8');
const dailyUpgradesList = dailyUpgrades.split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('*'))
    .map(line => line.replace('*', '').trim());

const condition = 150000;
const profitabilityLimit = 0.02;
const csvDataProxy = fs.readFileSync('proxy.csv', 'utf8');
const proxyList = csvDataProxy.split('\n').map(line => line.trim()).filter(line => line !== '');

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

async function getBalanceCoins(dancay, account) {
    const { authorization, name } = account;
    try {
        const response = await dancay.post('/clicker/sync', {}, {
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

async function buyUpgrades(dancay, account) {
    const { authorization, name } = account;
    try {
        const upgradesResponse = await dancay.post('/clicker/upgrades-for-buy', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (upgradesResponse.status === 200) {
            const upgrades = upgradesResponse.data.upgradesForBuy.map(it => ({
                ...it,
                profitability: it.profitPerHour / it.price
            }));
            let balanceCoins = await getBalanceCoins(dancay, account);
            let purchased = false;

            upgrades.sort((a, b) => b.profitability - a.profitability);

            for (const upgrade of upgrades) {
                if (upgrade.cooldownSeconds > 0) {
                    console.log(`[${name}] Upgrade ${upgrade.name} is in cooldown for ${upgrade.cooldownSeconds} seconds.`);
                    continue; 
                }

                if (upgrade.isAvailable && !upgrade.isExpired && upgrade.price < condition && upgrade.price <= balanceCoins && upgrade.profitability >= profitabilityLimit) {
                    const buyUpgradePayload = {
                        upgradeId: upgrade.id,
                        timestamp: Math.floor(Date.now() / 1000)
                    };
                    try {
                        const response = await dancay.post('/clicker/buy-upgrade', buyUpgradePayload, {
                            headers: {
                                'Authorization': `Bearer ${authorization}`
                            }
                        });
                        if (response.status === 200) {
                            console.log(`[${name}] (${Math.floor(balanceCoins)}$) Upgraded ${upgrade.name} to level ${upgrade.level + 1} by ${upgrade.price}$ with profitability ${upgrade.profitability}.`);
                            purchased = true;
                            balanceCoins -= upgrade.price; 
                        }
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
        } else {
            console.error(`[${name}] Failed to retrieve upgrade list. Status code:`, upgradesResponse.status);
            return false;
        }
    } catch (error) {
        console.error(`[${name}] Unexpected error, moving to the next token`);
        return false;
    }
    return true;
}

async function claimDailyCipher(dancay, { authorization, name }, cipher) {
    if (cipher) {
        try {
            const payload = {
                cipher: cipher
            };
            const response = await dancay.post('/clicker/claim-daily-cipher', payload, {
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

async function runForAuthorization(account, proxy, cipher) {
    const dancay = createAxiosInstance(proxy);
    await checkProxyIP(proxy);

    await claimDailyCipher(dancay, account, cipher);

    while (true) {
        const success = await buyUpgrades(dancay, account);
        if (!success) {
            break;
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

    for (let i = 0; i < authorizationList.length; i++) {
        const authorization = authorizationList[i];
        const [token, name] = authorization.split(':');
        const proxy = proxyList[i % proxyList.length];
        const account = {
            authorization: token,
            name: name || `Acc${i + 1}`
        };

        if (shouldUpgrade) { 
            await runForAuthorization(account, proxy, cipher);
        } else { 
            const dancay = createAxiosInstance(proxy);
            await checkProxyIP(proxy);
            await claimDailyCipher(dancay, account, cipher);
        }
    }
    console.log('All tokens have been processed.');
}

main();


