const axios = require('axios');
const fs = require('fs');
const { HttpsProxyAgent } = require('https-proxy-agent');
const readline = require('readline');

const csvDataAuth = fs.readFileSync('authorization.csv', 'utf8');
const authorizationList = csvDataAuth.split('\n').map(line => line.trim()).filter(line => line !== '');
const dieukien = 1000000;
const csvDataProxy = fs.readFileSync('proxy.csv', 'utf8');
const proxyList = csvDataProxy.split('\n').map(line => line.trim()).filter(line => line !== '');

function createAxiosInstance(proxy) {
    const proxyAgent = new HttpsProxyAgent(proxy);
    return axios.create({
        baseURL: 'https://api.hamsterkombatgame.io',
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
            console.log('Địa chỉ IP của proxy là:', response.data.ip);
        } else {
            console.error('Không thể kiểm tra IP của proxy. Status code:', response.status);
        }
    } catch (error) {
        console.error('Error khi kiểm tra IP của proxy:', error);
    }
}

async function getBalanceCoins(dancay, authorization) {
    try {
        const response = await dancay.post('/clicker/sync', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            return response.data.clickerUser.balanceCoins;
        } else {
            console.error('Không lấy được thông tin balanceCoins. Status code:', response.status);
            return null;
        }
    } catch (error) {
        console.error('Error:', error);
        return null;
    }
}

async function buyUpgrades(dancay, authorization) {
    try {
        const upgradesResponse = await dancay.post('/clicker/upgrades-for-buy', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (upgradesResponse.status === 200) {
            const upgrades = upgradesResponse.data.upgradesForBuy;
            let balanceCoins = await getBalanceCoins(dancay, authorization);

            const upgradePromises = upgrades.map(async (upgrade) => {
                if (upgrade.cooldownSeconds > 0) {
                    console.log(`Thẻ ${upgrade.name} đang trong thời gian cooldown ${upgrade.cooldownSeconds} giây.`);
                    return;
                }

                if (upgrade.isAvailable && !upgrade.isExpired && upgrade.price < dieukien && upgrade.price <= balanceCoins) {
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
                            console.log(`(${Math.floor(balanceCoins)}) Đã nâng cấp thẻ ${upgrade.name} cho token ${authorization}.`);
                            balanceCoins -= upgrade.price;
                        }
                    } catch (error) {
                        if (error.response && error.response.data && error.response.data.error_code === 'UPGRADE_COOLDOWN') {
                            console.log(`Thẻ ${upgrade.name} đang trong thời gian cooldown ${error.response.data.cooldownSeconds} giây.`);
                        } else {
                            throw error;
                        }
                    }
                }
            });

            await Promise.all(upgradePromises);
        } else {
            console.error('Không lấy được danh sách thẻ. Status code:', upgradesResponse.status);
        }
    } catch (error) {
        console.error('Lỗi không mong muốn, chuyển token tiếp theo');
    }
}

async function claimDailyCipher(dancay, authorization, cipher) {
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
                console.log(`Đã claim daily cipher với mã ${cipher} cho token ${authorization}`);
            } else {
                console.error('Không claim được daily cipher. Status code:', response.status);
            }
        } catch (error) {
            console.error('Mã morse đã được giải');
        }
    }
}

async function runForAuthorization(authorization, proxy, cipher) {
    const dancay = createAxiosInstance(proxy);
    await checkProxyIP(proxy);

    await claimDailyCipher(dancay, authorization, cipher);

    await buyUpgrades(dancay, authorization);
}

async function askForCipher() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise(resolve => {
        rl.question('Mã morse hôm nay cần giải: ', (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

async function main() {
    const cipher = await askForCipher();
    while (true) {
        for (let i = 0; i < authorizationList.length; i++) {
            const authorization = authorizationList[i];
            const proxy = proxyList[i % proxyList.length];
            await runForAuthorization(authorization, proxy, cipher);
        }
        console.log('Đã chạy xong tất cả các token, bắt đầu lại...');
    }
}

main();
