const teeworlds = require('teeworlds');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function runBot(server, baseName, botNumber, mode, voteChoice, chatMessage) {
    const [ip, port] = server.split(':');
    const botName = `${baseName}${botNumber.toString().padStart(3, '0')}`;
    const client = new teeworlds.Client(ip, parseInt(port), botName, { mod: "ddnet" });

    return {
        connect: async () => {
            try {
                await client.connect();
                console.log(`🤖 ${botName} подключился к ${ip}:${port}`);
            } catch (err) {
                console.log(`🤖 ${botName} ошибка подключения: ${err.message}`);
            }
        },
        say: async (message) => {
            try {
                await client.game.Say(message);
            } catch (err) {
                console.log(`🤖 ${botName} ошибка отправки: ${err.message}`);
            }
        },
        disconnect: async () => {
            try {
                await client.Disconnect();
            } catch (err) {
                console.log(`🤖 ${botName} ошибка отключения: ${err.message}`);
            }
        },
        setupListeners: () => {
            client.on("connected", () => {
                console.log(`🤖 ${botName} вошёл на сервер`);
            });
            client.on("disconnect", (reason) => {
                console.log(`🤖 ${botName} отключен: ${reason}`);
            });
            client.on("message", (message) => {
                if (message.author && message.author.ClientInfo) {
                    console.log(`💬 ${message.author.ClientInfo.name}: ${message.message}`);
                } else {
                    console.log(`📢 Системное сообщение: ${message.message}`);
                }
            });
            client.on("kill", (info) => {
                if (info.killer && info.victim && info.killer.ClientInfo && info.victim.ClientInfo) {
                    console.log(` ${info.killer.ClientInfo.name} убил ${info.victim.ClientInfo.name}`);
                }
            });
            client.on("error", (err) => {
                console.log(`⚠️ ${botName} ошибка: ${err.message}`);
            });
        }
    };
}

async function runBotGroup(server, baseName, botCount, mode, voteChoice, chatMessage) {
    const bots = [];
    for (let i = 1; i <= botCount; i++) {
        const bot = await runBot(server, baseName, i, mode, voteChoice, chatMessage);
        bot.setupListeners();
        bots.push(bot);
    }

    let firstCycle = true;

    async function actionLoop() {
        try {
            if (firstCycle) {
                console.log("Подключаю всех ботов...");
                await Promise.all(bots.map(bot => bot.connect()));
            } else {
                await Promise.all(bots.map(bot => bot.connect()));
            }
            await new Promise(resolve => setTimeout(resolve, 2000));

            if (mode === "spam") {
                if (firstCycle) console.log("Режим спама, действия не требуется...");
            } else if (mode === "vote") {
                if (firstCycle) {
                    console.log("Все боты голосуют...");
                    await Promise.all(bots.map(bot => bot.say(voteChoice === "yes" ? "yes" : "no")));
                    console.log(`✅ Все ${botCount} ботов проголосовали: ${voteChoice === "yes" ? "да" : "нет"}`);
                } else {
                    await Promise.all(bots.map(bot => bot.say(voteChoice === "yes" ? "yes" : "no")));
                    console.log(`✅ Боты проголосовали в ${new Date().toLocaleTimeString()}`);
                }
            } else if (mode === "chat") {
                if (firstCycle) {
                    console.log("Все боты пишут сообщение...");
                    await Promise.all(bots.map(bot => bot.say(chatMessage)));
                    console.log(`✅ Все ${botCount} ботов отправили сообщение: "${chatMessage}"`);
                } else {
                    await Promise.all(bots.map(bot => bot.say(chatMessage)));
                    console.log(`✅ Боты отправили сообщение в ${new Date().toLocaleTimeString()}`);
                }
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
            if (firstCycle) {
                console.log("Отключаю всех ботов...");
                await Promise.all(bots.map(bot => bot.disconnect()));
                firstCycle = false;
            } else {
                await Promise.all(bots.map(bot => bot.disconnect()));
                console.log(`🔌 Боты отключились в ${new Date().toLocaleTimeString()}`);
            }

            setTimeout(actionLoop, 1000);
        } catch (err) {
            console.log(` Ошибка в группе ботов: ${err.message}`);
            setTimeout(actionLoop, 2000);
        }
    }

    actionLoop();
}

async function main() {
    console.log(`
 /_/\  
( o.o ) 
 > ^ <
   TW-SPAMER-BOT 
by @keepyourhuman & @Black0re0
DDNet 18.0.9.0 Support
    `);
    const server = await askQuestion("Введите IP:порт сервера (например, 68.29.94.32:8303): ");
    const baseName = await askQuestion("Введите базовый ник для ботов: ");
    const botCount = parseInt(await askQuestion("Сколько ботов запустить? "));

    console.log("\nВыберите режим работы ботов:");
    console.log("1. Спам — боты заходят и выходят");
    console.log("2. Болванка — боты просто сидят на сервере");
    console.log("3. Голосование — боты голосуют и выходят");
    console.log("4. Сообщения — боты пишут в чат и выходят");
    const modeChoice = await askQuestion("Введите номер режима (1-4): ");

    let mode, voteChoice, chatMessage;
    if (modeChoice === "1") {
        mode = "spam";
    } else if (modeChoice === "2") {
        mode = "dummy";
    } else if (modeChoice === "3") {
        mode = "vote";
        voteChoice = await askQuestion("За что голосовать? (yes/no): ");
        while (voteChoice !== "yes" && voteChoice !== "no") {
            voteChoice = await askQuestion("Пожалуйста, введите 'yes' или 'no': ");
        }
    } else if (modeChoice === "4") {
        mode = "chat";
        chatMessage = await askQuestion("Какое сообщение писать в чат? ");
    } else {
        console.log("Неверный выбор! По умолчанию выбрана болванка.");
        mode = "dummy";
    }

    console.log(`\nЗапускаю ${botCount} ботов на ${server} в режиме "${mode}"...\n`);

    if (mode === "dummy") {
        const bots = [];
        for (let i = 1; i <= botCount; i++) {
            const bot = await runBot(server, baseName, i, mode, voteChoice, chatMessage);
            bot.setupListeners();
            bots.push(bot.connect());
        }
        await Promise.all(bots);
    } else {
        runBotGroup(server, baseName, botCount, mode, voteChoice, chatMessage);
    }
}

console.log("Введите 'bot' для запуска:");
rl.on('line', (input) => {
    if (input.trim() === "bot") {
        main().then(() => {
            console.log("Все боты запущены! Нажми Ctrl+C для остановки.");
        }).catch(err => {
            console.error("Ошибка:", err);
            rl.close();
        });
    }
});

process.on("SIGINT", () => {
    console.log("\nОстанавливаю ботов...");
    rl.close();
    process.exit(0);
});