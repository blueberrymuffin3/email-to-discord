import { SMTPServer } from 'smtp-server';
import { simpleParser } from 'mailparser';
import fetch from 'node-fetch';
import FormData from 'form-data';

const MAX_MESSAGE_LEN = 2_000
const MAX_MESSAGE_ATTACHED_LEN = 8_000_000
const FIELD_MAX_LEN = 50 // Length limit for things that should generally be short
const EMAIL_TRUNCATED_MESSAGE = '...\nEmail was truncated, full email is attached'
const WEBHOOK_URL = process.env.WEBHOOK_URL

function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        let chunks = []
        stream.on('data', chunk => chunks.push(chunk))
        stream.on('end', () => resolve(Buffer.concat(chunks)))
        stream.on('error', reject)
    })
}

async function sendMessageFull(content, username) {
    console.log(content)
    console.log(content.length)

    let response = await fetch(WEBHOOK_URL + '?wait=true', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, username })
    })

    if (!response.ok) {
        throw new Error(`Error: response ${response.status} (${response.statusText})\n${await response.text()}`)
    }
}

async function sendMessageTruncatedAttachment(content, username, email) {
    let formData = new FormData()

    let payload = JSON.stringify({
        content, username,
        attachments: [{
            id: 0,
            ephemeral: true
        }]
    })

    formData.append('payload_json', payload, { contentType: 'application/json' })
    formData.append('files[0]', email, { contentType: 'message/rfc822', filename: 'email.eml' })

    let response = await fetch(WEBHOOK_URL + '?wait=true', {
        method: 'POST',
        body: formData
    })

    if (!response.ok) {
        throw new Error(`Error: response ${response.status} (${response.statusText})\n${await response.buffer()}`)
    }
}

async function onData(stream) {
    let email = await streamToBuffer(stream)

    if (email.length > MAX_MESSAGE_ATTACHED_LEN) {
        throw new Error(`Email too large, max size is ${MAX_MESSAGE_ATTACHED_LEN} bytes`)
    }

    let parsed = await simpleParser(email, {})
    console.log(`New message from ${parsed.from?.text} to ${parsed.to?.text} "${parsed.subject}"`)

    console.log(parsed)
    let content = 'No Content'
    if (parsed.text) {
        content = parsed.text.trim()
            .split('\n')
            .map(line => `> ${line || ''}\n`)
    }

    console.log('Forwarding message to discord webhook')

    let to = 'Unknown'
    if (parsed.to) {
        if (Array.isArray(parsed.to)) {
            to = parsed.to.map(x => x.text).join(', ')
        } else {
            to = parsed.to.text
        }
    }

    let from = 'Unknown'
    if (parsed.from) {
        from = parsed.from.text.trim(0, FIELD_MAX_LEN)
    }

    let message = `To: \`${to}\`\n` +
        `Date: <t:${Math.floor(parsed.date?.getTime() / 1000)}>\n` +
        `Subject: **${parsed.subject.trim(0, FIELD_MAX_LEN)}**\n`
    let username = `Email from ${from}`

    for (let line of content) {
        if (message.length + line.length + EMAIL_TRUNCATED_MESSAGE.length > MAX_MESSAGE_LEN) {
            message += EMAIL_TRUNCATED_MESSAGE
            await sendMessageTruncatedAttachment(message, username, email)
            console.log('Sent truncated message')
            return
        }
        message += line
    }

    await sendMessageFull(message, username)
    console.log('Sent full message')
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

server.on('error', err => {
    console.error('Error %s', err.message);
});

process.on('SIGTERM', () => {
    console.log('Shutting Down...')
    server.close()
})

process.on('SIGINT', () => {
    console.log('Shutting Down...')
    server.close()
})

console.log('Starting Server')
server.listen(8025)
