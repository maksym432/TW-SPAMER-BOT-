const teeworlds = require('teeworlds')
const readline = require('readline')
const fs = require('fs').promises
const chalk = require('chalk')
const { SocksProxyAgent } = require('socks-proxy-agent')
const { HttpProxyAgent } = require('http-proxy-agent')
const axios = require('axios')

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
})

const DDNET_VERSION = {
    version: 18,
    release_version: '19.2'
}

let activeBots = new Set()

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve))
}

async function logError(message) {
    try {
        await fs.appendFile('error.log', `${new Date().toISOString()} - ${message}\n`)
    } catch (err) {
        console.log(chalk.red(`❌ Ошибка записи в error.log: ${err.message}`))
    }
}

async function logSuccess(message) {
    try {
        await fs.appendFile('success.log', `${new Date().toISOString()} - ${message}\n`)
    } catch (err) {
        console.log(chalk.red(`❌ Ошибка записи в success.log: ${err.message}`))
    }
}

async function loadProxiesFromFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8')
        const lines = data.split('\n').filter(line => line.trim() !== '')
        if (lines.length === 0) {
            return []
        }
        const proxies = lines.map(line => {
            const [type, rest] = line.includes('://') ? line.split('://') : ['socks5', line]
            return { type: type.toLowerCase(), url: line }
        })
        console.log(chalk.cyan(`🔐 Загружено ${proxies.length} прокси, проверка...`))

        const workingProxies = []
        const uniqueIPs = new Set()

        for (const proxy of proxies) {
            const result = await testProxy(proxy)
            if (result && !uniqueIPs.has(result.ip)) {
                uniqueIPs.add(result.ip)
                workingProxies.push({ ...proxy, ip: result.ip })
                console.log(chalk.green(`✅ Прокси ${proxy.url} работает (IP: ${result.ip})`))
            } else {
                console.log(chalk.red(`❌ Прокси ${proxy.url} не работает или дублирует IP`))
            }
        }
        console.log(chalk.cyan(`🔐 Найдено ${workingProxies.length} рабочих прокси с уникальными IP`))
        await fs.writeFile('working_proxies.txt', workingProxies.map(p => p.url).join('\n'))
        return workingProxies
    } catch (err) {
        console.log(chalk.red(`❌ Не удалось загрузить proxies.txt: ${err.message}`))
        await logError(`Не удалось загрузить proxies.txt: ${err.message}`)
        return []
    }
}

async function testProxy(proxy) {
    try {
        const agent = proxy.type.includes('http') ? new HttpProxyAgent(proxy.url) : new SocksProxyAgent(proxy.url)
        const ipResponse = await axios.get('http://ifconfig.me', { httpsAgent: agent, timeout: 15000 })
        const ip = ipResponse.data
        const client = new teeworlds.Client('193.176.83.169', 12549, 'Test', {
            agent,
            timeout: 10000,
            mod: 'ddnet'
        })
        await client.connect()
        client.Disconnect()
        return { ip }
    } catch (err) {
        await logError(`Прокси ${proxy.url} не работает: ${err.message}`)
        return null
    }
}

function printProgress(current, total) {
    const percentage = Math.round((current / total) * 100)
    const barLength = 20
    const filled = Math.round(barLength * (current / total))
    const bar = '█'.repeat(filled) + '-'.repeat(barLength - filled)
    process.stdout.write(`\r${chalk.cyan(`[${bar}] ${percentage}% (${current}/${total})`)}`)
}

async function createBot(server, baseName, botNumber, proxy = null) {
    const [ip, port] = server.split(':')
    if (!ip || !port || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || !/^\d{1,5}$/.test(port)) {
        throw new Error('Неверный формат сервера (ожидается IP:порт)')
    }

    const botName = `${baseName}${botNumber.toString().padStart(3, '0')}`

    let agent = null
    if (proxy) {
        try {
            agent = proxy.type.includes('http') ? new HttpProxyAgent(proxy.url) : new SocksProxyAgent(proxy.url)
        } catch (err) {
            console.log(chalk.red(`❌ Ошибка создания прокси для ${botName}: ${err.message}`))
            await logError(`Ошибка создания прокси для ${botName}: ${err.message}`)
            return null
        }
    }

    const clientOptions = {
        identity: {
            name: botName,
            clan: '',
            skin: 'default',
            use_custom_color: 0,
            color_body: 0,
            color_feet: 0,
            country: -1
        },
        timeout: 10000,
        lightweight: true,
        ddnet_version: DDNET_VERSION,
        retries: 3,
        retryDelay: 2000,
        mod: 'ddnet'
    }
    if (agent) {
        clientOptions.agent = agent
    }

    const client = new teeworlds.Client(ip, parseInt(port), botName, clientOptions)
    let isConnected = false

    client.on('connected', () => {
        isConnected = true
        console.log(chalk.green(`✅ ${botName} подключился к ${ip}:${port} через ${proxy ? proxy.url : 'без прокси'}`))
    })

    client.on('disconnect', (reason) => {
        isConnected = false
        activeBots.delete(client)
        console.log(chalk.gray(`🔌 ${botName} отключен: ${reason || 'без причины'}`))
    })

    client.on('error', (err) => {
        console.log(chalk.red(`❌ ${botName} ошибка: ${err.message}`))
        logError(`${botName} ошибка: ${err.message}`)
    })

    activeBots.add(client)
    client.isConnected = () => isConnected

    client.sendInput = (input = {}) => {
        try {
            const defaults = {
                direction: 0, target_x: 0, target_y: 0, jump: 0, fire: 0, hook: 0,
                player_flags: 0, wanted_weapon: 0, next_weapon: 0, prev_weapon: 0
            }
            const packet = { ...defaults, ...input }
            if (client._sendInput) client._sendInput(packet)
            else if (client.sendInputPacket) client.sendInputPacket(packet)
        } catch (e) {
            console.log(chalk.red(`❌ ${botName} ошибка sendInput: ${e.message}`))
            logError(`${botName} ошибка sendInput: ${e.message}`)
        }
    }

    client.performActions = () => {
        setInterval(() => {
            if (client && client.isConnected()) {
                const actions = [
                    { direction: Math.random() > 0.5 ? 1 : -1 },
                    { jump: 1 },
                    { fire: 1 },
                    { hook: 1 }
                ]
                client.sendInput(actions[Math.floor(Math.random() * actions.length)])
            }
        }, 1000)
    }

    let attempts = 0
    const maxAttempts = 3
    while (attempts < maxAttempts) {
        try {
            await client.connect()
            return client
        } catch (err) {
            attempts++
            console.log(chalk.red(`❌ ${botName} ошибка подключения (${attempts}/${maxAttempts}): ${err.message}`))
            await logError(`${botName} ошибка подключения (${attempts}/${maxAttempts}): ${err.message}`)
            if (attempts === maxAttempts) {
                client.Disconnect()
                activeBots.delete(client)
                return null
            }
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }
}

async function disconnectAllBots() {
    const bots = [...activeBots]
    activeBots.clear()
    await Promise.all(bots.map(bot => {
        try {
            return bot.Disconnect()
        } catch (e) {
            console.log(chalk.red(`❌ Ошибка отключения бота: ${e.message}`))
            logError(`Ошибка отключения бота: ${e.message}`)
        }
    }))
}

async function runBotGroup(server, baseName, botCount, chatMessage, mode, proxies, delay = 1000) {
    const maxBotsPerProxy = 2
    const maxBots = proxies.length ? Math.min(botCount, proxies.length * maxBotsPerProxy) : Math.min(botCount, 4)
    console.log(chalk.bold(`🚀 Запускаю ${maxBots} ботов на ${server} с ${proxies.length} прокси...`))

    const effectiveProxies = proxies.length === 1 ? Array(maxBots).fill(proxies[0]) : proxies

    if (mode === '1') {
        console.log(chalk.cyan('💬 Режим "Спам сообщениями": боты входят, отправляют сообщение и выходят'))
        let connectedCount = 0
        let messagesSent = 0
        const startTime = Date.now()
        const failedConnections = []

        for (let i = 0; i < maxBots; i += maxBotsPerProxy) {
            const batchSize = Math.min(maxBotsPerProxy, maxBots - i)
            const batchPromises = []

            for (let j = 0; j < batchSize; j++) {
                const botIndex = i + j + 1
                const proxy = effectiveProxies.length ? effectiveProxies[Math.floor((i + j) / maxBotsPerProxy) % effectiveProxies.length] : null
                batchPromises.push((async () => {
                    const bot = await createBot(server, baseName, botIndex, proxy)
                    if (!bot) {
                        failedConnections.push({ bot: botIndex, reason: 'Не удалось создать бота' })
                        return
                    }

                    bot.once('connected', async () => {
                        if (!bot.isConnected()) return
                        connectedCount++
                        bot.sendInput()
                        printProgress(connectedCount, maxBots)

                        await new Promise(resolve => setTimeout(resolve, 2000))

                        try {
                            if (bot.identity && bot.identity.name && bot.game && bot.isConnected()) {
                                const messages = ['Hello', 'Hi', 'Yo', 'Greetings', 'Sup', 'Hey', chatMessage].filter(m => m)
                                const message = messages[Math.floor(Math.random() * messages.length)]
                                await bot.game.Say(message)
                                messagesSent++
                                console.log(chalk.cyan(`💬 ${bot.identity.name} отправил: ${message}`))
                                await logSuccess(`${bot.identity.name} отправил: ${message}`)
                            } else {
                                console.log(chalk.yellow(`⚠️ Бот ${botIndex} не инициализирован`))
                                await logError(`Бот ${botIndex} не инициализирован`)
                            }
                        } catch (e) {
                            console.log(chalk.red(`❌ Ошибка отправки для ${bot.identity?.name || botIndex}: ${e.message}`))
                            await logError(`Ошибка отправки для ${bot.identity?.name || botIndex}: ${e.message}`)
                        }

                        await new Promise(resolve => setTimeout(resolve, 1000))
                        bot.Disconnect()
                    })
                    bot.connect()
                })())
            }

            await Promise.all(batchPromises)
            await new Promise(resolve => setTimeout(resolve, delay))
        }

        await disconnectAllBots()
        const elapsedTime = (Date.now() - startTime) / 1000
        console.log(chalk.green(`\n✅ Спам завершен: ${messagesSent} сообщений за ${elapsedTime.toFixed(1)}с`))
        if (failedConnections.length) {
            console.log(chalk.yellow(`⚠️ Неудачных подключений: ${failedConnections.length}`))
            failedConnections.forEach(f => console.log(chalk.red(`❌ Бот #${f.bot}: ${f.reason}`)))
        }
    } else if (mode === '2') {
        console.log(chalk.cyan('🧍 Режим "Болванка": боты подключаются с действиями'))
        let connectedCount = 0
        const failedConnections = []

        for (let i = 0; i < maxBots; i += maxBotsPerProxy) {
            const batchSize = Math.min(maxBotsPerProxy, maxBots - i)
            const batchPromises = []

            for (let j = 0; j < batchSize; j++) {
                const botIndex = i + j + 1
                const proxy = effectiveProxies.length ? effectiveProxies[Math.floor((i + j) / maxBotsPerProxy) % effectiveProxies.length] : null
                batchPromises.push((async () => {
                    const bot = await createBot(server, baseName, botIndex, proxy)
                    if (!bot) {
                        failedConnections.push({ bot: botIndex, reason: 'Не удалось создать бота' })
                        return
                    }

                    bot.once('connected', () => {
                        if (!bot.isConnected()) return
                        connectedCount++
                        bot.sendInput()
                        bot.performActions()
                        printProgress(connectedCount, maxBots)
                        console.log(chalk.green(`✅ Бот #${connectedCount} подключен`))
                    })
                    bot.connect()
                })())
            }

            await Promise.all(batchPromises)
            await new Promise(resolve => setTimeout(resolve, delay))
        }

        console.log(chalk.green('\n✅ Подключение завершено! Нажми Ctrl+C для остановки'))
        if (failedConnections.length) {
            console.log(chalk.yellow(`⚠️ Неудачных подключений: ${failedConnections.length}`))
            failedConnections.forEach(f => console.log(chalk.red(`❌ Бот #${f.bot}: ${f.reason}`)))
        }
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000))
        }
    } else if (mode === '4') {
        console.log(chalk.cyan('⚡ Режим "Турбо": боты быстро входят и выходят'))
        let connectedCount = 0
        let totalJoins = 0
        const startTime = Date.now()
        const failedConnections = []

        while (true) {
            connectedCount = 0
            for (let i = 0; i < maxBots; i += maxBotsPerProxy) {
                const batchSize = Math.min(maxBotsPerProxy, maxBots - i)
                const batchPromises = []

                for (let j = 0; j < batchSize; j++) {
                    const botIndex = i + j + 1
                    const proxy = effectiveProxies.length ? effectiveProxies[Math.floor((i + j) / maxBotsPerProxy) % effectiveProxies.length] : null
                    batchPromises.push((async () => {
                        const bot = await createBot(server, baseName, botIndex, proxy)
                        if (!bot) {
                            failedConnections.push({ bot: botIndex, reason: 'Не удалось создать бота' })
                            return
                        }

                        bot.once('connected', async () => {
                            if (!bot.isConnected()) return
                            connectedCount++
                            totalJoins++
                            bot.sendInput()
                            printProgress(connectedCount, maxBots)
                            await new Promise(resolve => setTimeout(resolve, delay))
                            bot.Disconnect()
                        })
                        bot.connect()
                    })())
                }

                await Promise.all(batchPromises)
                await new Promise(resolve => setTimeout(resolve, delay))
            }

            await disconnectAllBots()
            const elapsedTime = (Date.now() - startTime) / 1000
            console.log(chalk.green(`\n✅ Цикл завершен: ${totalJoins} подключений за ${elapsedTime.toFixed(1)}с`))
            if (failedConnections.length) {
                console.log(chalk.yellow(`⚠️ Неудачных подключений: ${failedConnections.length}`))
                failedConnections.forEach(f => console.log(chalk.red(`❌ Бот #${f.bot}: ${f.reason}`)))
            }
            await new Promise(resolve => setTimeout(resolve, 500))
        }
    }
}

async function runMassSpam(servers, baseName, botCount, chatMessage, proxies) {
    console.log(chalk.bold(`🚀 Запускаю массовый спам на ${servers.length} серверах...`))
    const maxBotsPerProxy = 2
    const effectiveProxies = proxies.length === 1 ? Array(botCount).fill(proxies[0]) : proxies
    const spamPromises = servers.map(server => {
        return runBotGroup(server, baseName, Math.min(botCount, effectiveProxies.length * maxBotsPerProxy), chatMessage, '1', effectiveProxies)
    })
    await Promise.all(spamPromises)
}

async function collectServers() {
    const servers = []
    while (true) {
        const server = await askQuestion(chalk.yellow(`🌐 Введите IP:порт сервера ${servers.length + 1} (Enter для завершения): `))
        if (server.trim() === '') break
        if (/^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(server)) {
            servers.push(server)
        } else {
            console.log(chalk.red('❌ Неверный формат сервера (ожидается IP:порт)'))
        }
    }
    return servers
}

async function showMenu() {
    console.log(chalk.bold.cyan(`
 /_/\\  
( o.o ) 
 > ^ <
   TW-SPAMER-BOT 
by @keepyourhuman & @Black0re0
DDNet 18.7 Support
    `))
    console.log(chalk.yellow('=== Меню ==='))
    console.log(chalk.cyan('1. Спам сообщениями (вход → сообщение → выход)'))
    console.log(chalk.cyan('2. Болванка (подключение с действиями)'))
    console.log(chalk.cyan('3. Рассылка (спам на нескольких серверах)'))
    console.log(chalk.cyan('4. Турбо-режим (быстрый вход/выход)'))
    console.log(chalk.cyan('5. Выход'))
    const choice = await askQuestion(chalk.yellow('Выберите режим (1-5): '))

    if (choice === '5') {
        console.log(chalk.green('👋 Выход...'))
        await disconnectAllBots()
        rl.close()
        process.exit(0)
    }

    if (!['1', '2', '3', '4'].includes(choice)) {
        console.log(chalk.red('❌ Неверный выбор. Попробуйте снова.'))
        return showMenu()
    }

    const proxies = await loadProxiesFromFile('proxies.txt')
    if (proxies.length === 0) {
        const useProxies = await askQuestion(chalk.yellow('⚠️ Рабочие прокси не найдены. Продолжить без прокси? (y/n): ')) === 'y'
        if (!useProxies) {
            console.log(chalk.red('❌ Работа без прокси отклонена. Попробуйте снова.'))
            return showMenu()
        }
    }

    let servers = []
    let baseName = ''
    let botCount = 1
    let chatMessage = ''
    let botDelay = 1000

    if (choice === '3') {
        servers = await collectServers()
        if (servers.length === 0) {
            console.log(chalk.red('❌ Не указано ни одного сервера. Попробуйте снова.'))
            return showMenu()
        }
        baseName = await askQuestion(chalk.yellow('🧑 Введите базовый ник для ботов: '))
        const botCountInput = await askQuestion(chalk.yellow(`🤖 Сколько ботов запустить на каждый сервер? (макс. ${proxies.length * 2 || 4}): `))
        botCount = parseInt(botCountInput) || 1
        chatMessage = await askQuestion(chalk.yellow('💬 Какое сообщение писать в чат? (Enter для случайных): ')) || 'Hello'
    } else {
        const server = await askQuestion(chalk.yellow('🌐 Введите IP:порт сервера (например, 193.176.83.169:12549): '))
        if (!/^(\d{1,3}\.){3}\d{1,3}:\d{1,5}$/.test(server)) {
            console.log(chalk.red('❌ Неверный формат сервера (ожидается IP:порт)'))
            return showMenu()
        }
        servers = [server]
        baseName = await askQuestion(chalk.yellow('🧑 Введите базовый ник для ботов: '))
        const botCountInput = await askQuestion(chalk.yellow(`🤖 Сколько ботов запустить? (макс. ${proxies.length * 2 || 4}): `))
        botCount = parseInt(botCountInput) || 1
        if (choice === '1') {
            chatMessage = await askQuestion(chalk.yellow('💬 Какое сообщение писать в чат? (Enter для случайных): ')) || 'Hello'
        }
        if (choice === '4') {
            const delayInput = await askQuestion(chalk.yellow('⏳ Задержка между подключениями (мс, Enter для 1000): '))
            botDelay = parseInt(delayInput) || 1000
        }
    }

    const maxBotsPerProxy = 2
    if (proxies.length && botCount > proxies.length * maxBotsPerProxy) {
        console.log(chalk.yellow(`⚠️ Запроше