import { SMTPServer } from "smtp-server";
import { simpleParser } from "mailparser";
import fetch from "node-fetch";

const MAX_MESSAGE_LEN = 2000
const WEBHOOK_URL = process.env.WEBHOOK_URL
const TZ = process.env.TZ || 'UTC'

async function sendMessage(content, username) {
    let response = await fetch(WEBHOOK_URL + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, username })
    })

    if (!response.ok) {
        throw new Error(`Error: response ${response.status} (${response.statusText})\n${await response.text()}`)
    }
}

async function onData(stream, session) {
    let parsed = await simpleParser(stream, {})
    console.log(`New message from ${parsed.from.text} to ${parsed.to?.text} "${parsed.subject}"`)

    let content = parsed.text.trim()
        .split('\n')
        // Split lines longer than 2000 chars into multiple lines
        .flatMap(line => line.match(new RegExp(`.{1,${MAX_MESSAGE_LEN - 5}}`)))
        .map(line => `> ${line || ''}\n`)

    console.log("Forwarding message to discord webhook")

    let to = ''
    if (Array.isArray(parsed.to)) {
        to = parsed.to.map(x => x.text).join(', ')
    } else {
        to = parsed.to.text
    }

    let message = `To: \`${to}\`\n` +
        `Date: <t:${Math.floor(parsed.date.getTime() / 1000)}>\n` +
        `Subject: **${parsed.subject}**\n`
    let username = `Email from ${parsed.from.text}`

    // Split long emails into multiple messages
    for (let line of content) {
        if (message.length + line.length > MAX_MESSAGE_LEN) {
            await sendMessage(message, username)
            console.log("sent partial message")
            message = ''
        }
        message += line
    }
    await sendMessage(message, username)

    console.log("Message forwarded successfully")
}

const server = new SMTPServer({
    onData(stream, session, callback) {
        onData(stream)
            .catch(error => {
                console.error(error)
                callback(error)
            })
            .then(callback)
    },
    authOptional: true
});

server.on("error", err => {
    console.error("Error %s", err.message);
});

process.on('SIGTERM', () => {
    console.log("Shutting Down...")
    server.close()
})

console.log("Starting Server")
server.listen(8025)
