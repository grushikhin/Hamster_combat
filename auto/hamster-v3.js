const axios = require('axios');

const authorization = process.argv[2];
const name = process.argv[3];

const MILISECOND = 1000;
const MINUTES = 60 * MILISECOND;
const timeWaitToRecharge = 10 * MINUTES;

let timeBuyBoost = null;

const axiosInstance = axios.create({
    baseURL: 'https://api.hamsterkombat.io',
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json'
    }
});

async function buyBoost(authorization) {
    try {
        const payload = {
            boostId: "BoostFullAvailableTaps",
            timestamp: timeBuyBoost
        };

        const response = await axiosInstance.post('/clicker/buy-boost', payload, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            timeBuyBoost = Date.now();
            console.log(`[${name}] Buy Boost thành công !!!`);
        }
    } catch (error) {
        console.log(`[${name}] Buy Boost thất bại vì lí do ${error}.`);
        // setTimeout(() => checkBoost(authorization), 2000); // Pass function reference
    }
    return null;
}

async function checkBoost(authorization) {
    try {
        const response = await axiosInstance.post('/clicker/boosts-for-buy', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            const data = response.data;
            const boostsForBuy = data.boostsForBuy;
            const boostFullAvailableTaps = boostsForBuy.find(boost => boost.id === "BoostFullAvailableTaps");
            const cooldownSeconds = boostFullAvailableTaps.cooldownSeconds;

            if (cooldownSeconds === 0) {
                buyBoost(authorization);
            } else {
                console.log(`[${name}] Boost đang hồi trong ${Math.ceil(cooldownSeconds / 60)} phút nữa`);
            }
        }
    } catch (error) {
        console.error(`[${name}] Error:`, error);
    }
    return null;
}

async function clickWithAPI(authorization) {
    try {
        const payload = {
            count: 2,
            availableTaps: 1500,
            timestamp: Date.now()
        };

        const response = await axiosInstance.post('/clicker/tap', payload, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            const data = response.data;
            const clickerUser = data.clickerUser;
            const requiredFields = {
                Balance: clickerUser.balanceCoins,
                Level: clickerUser.level,
                availableTaps: clickerUser.availableTaps,
                maxTaps: clickerUser.maxTaps
            };
            console.log(`[${name}] Đang tap:`, requiredFields);
            return requiredFields;
        } else {
            console.error(`[${name}] Không bấm được. Status code:`, response.status);
        }
    } catch (error) {
        console.error(`[${name}] Error:`, error);
    }
    return null;
}

async function checkTasks(authorization) {
    try {
        const response = await axiosInstance.post('/clicker/list-tasks', {}, {
            headers: {
                'Authorization': `Bearer ${authorization}`
            }
        });

        if (response.status === 200) {
            const tasks = response.data.tasks;
            for (const task of tasks) {
                if (task.id === 'streak_days' && !task.isCompleted) {
                    await axiosInstance.post('/clicker/check-task', { taskId: 'streak_days' }, {
                        headers: {
                            'Authorization': `Bearer ${authorization}`
                        }
                    });
                    console.log(`[${name}] Đã điểm danh hàng ngày cho token ${authorization}`);
                }
            }
        } else {
            console.error(`[${name}] Không lấy được danh sách nhiệm vụ. Status code:`, response.status);
        }
    } catch (error) {
        console.error(`[${name}] Error:`, error);
    }
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runForAuthorization(authorization) {
    await checkTasks(authorization);

    while (true) {
        const requests = Array.from({ length: 5 }, () => clickWithAPI(authorization));
        const results = await Promise.all(requests);
        const clickData = results[results.length - 1];
        if (clickData && clickData.availableTaps < 10) {
            console.log(`[${name}] Token ${authorization} có năng lượng nhỏ hơn 10. Đợi hồi năng lượng...`);
            if (Date.now() - timeBuyBoost > 60 * MINUTES) {
                console.log(`[${name}] Đang chuẩn bị sử dụng Boost...`);
                await checkBoost(authorization);
            }
            await wait(timeWaitToRecharge); // Wait for the specified recharge time before retrying
        } else {
            await wait(10); // Short delay before next set of clicks
        }
    }
}

async function main() {
    await runForAuthorization(authorization);
}

main();
