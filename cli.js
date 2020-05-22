#!/usr/bin/env node

const fs = require('fs');

const Discord = require('discord.js');
const chalk = require('chalk');
const ms = require('ms');

const MIN_TIME = 30000; // ms
const MAX_TIME = 1000 * 60 * 30; // ms
const MIN_TIME_SHORT = 500; // ms
const MAX_TIME_SHORT = 2000; // ms
const SHORT_TIMEOUT_CHANCE = 0.2;

const client = new Discord.Client();

const env = (name, def) => {
	if (name in process.env) return process.env[name];
	if (def !== undefined) return def;
	throw new Error(`required environment variable is missing: ${name}`);
};

const genTimeoutMS = long => (!long && Math.random() <= SHORT_TIMEOUT_CHANCE)
	? { ms: Math.floor(Math.random() * (MAX_TIME_SHORT - MIN_TIME_SHORT) + MIN_TIME_SHORT), type: 'short' }
	: { ms: Math.floor(Math.random() * (MAX_TIME - MIN_TIME) + MIN_TIME), type: 'long' };

const dbPath = env('SPEECH_DB');
const adminChannel = env('DISCORD_ADMIN_CHANNEL');

let speechDB = (() => {
	try {
		return JSON.parse(fs.readFileSync(dbPath, 'utf-8'));
	} catch (err) {
		if (err.code == 'ENOENT') {
			console.log('no database; initializing one:', dbPath);
			fs.writeFileSync(dbPath, '[]');
			return [];
		} else {
			throw err;
		}
	}
})();

console.log('loaded', speechDB.length, 'terms');

function addSpeech(term) {
	speechDB.push(term);
	fs.writeFileSync(dbPath, JSON.stringify(speechDB));
	console.log('added term:', chalk.bold(term));
}

function generateSpeech() {
	const idx = Math.floor(Math.random() * speechDB.length);
	return speechDB[idx];
}

async function doChatter(chid) {
	if (speechDB.length > 0) {
		const ch = client.channels.cache.get(chid);
		const term = generateSpeech();
		await ch.send(`_${term}_`);
		const nextDelay = genTimeoutMS();
		console.log(chalk`{dim 🦜 {magenta ${ch.guild.name}}#{cyan ${ch.name}} "${term}" (next in {yellow ${ms(nextDelay.ms)} ({green ${nextDelay.type}})})}`);
		scheduleChatter(chid, nextDelay);
	} else {
		console.log('WARNING: no phrases in database; nothing to send to channel');
		scheduleChatter(chid);
	}
}

function scheduleChatter(chid, delay) {
	delay = delay || genTimeoutMS();
	const {ms: msdelay} = delay;
	setTimeout(doChatter, msdelay, chid);
	const ch = client.channels.cache.get(chid);
}

client.on('ready', () => {
	console.log(chalk`logged in as {bold.keyword('lime') ${client.user.tag}}!`);

	// Set up initial timeouts
	for (const [id, ch] of client.channels.cache.entries()) {
		if (ch.type === 'text') {
			const delay = genTimeoutMS(true);
			scheduleChatter(id, delay);
			console.log(chalk`{dim scheduled {magenta ${ch.guild.name}}#{cyan ${ch.name}} in {yellow ${ms(delay.ms)}} ({green long})}`);
		}
	}
});

const commands = {
	'add': async ({msg, raw}) => {
		addSpeech(raw);
		await msg.react('✅');
		await msg.reply(`added: _"${raw}"_`);
	}
};

client.on('message', async msg => {
	if (msg.channel.id === adminChannel) {
		const isOwner = msg.guild && msg.member && msg.member.id === msg.guild.ownerID;

		if (isOwner && msg.mentions.has(client.user) && msg.type === 'DEFAULT') {
			const match = msg.content.match(/^<@!(\d+)>\s*!(\w+)(?:\s+(.+?))?\s*$/);
			if (!match || match[1] !== client.user.id || !commands[match[2]]) {
				await msg.react('⁉️');
				return;
			}

			const raw = match[3] || '';
			const args = raw.trim().split(/[\t\s]+/g);
			console.log(chalk`{magenta.bold ADMIN ({red ${msg.member.displayName} {dim ${msg.member.id}}}):} {cyan !${match[2]}} ${raw}`);
			await commands[match[2]]({msg, raw, args});
		}
	}
});

client.login(env('DISCORD_TOKEN'));
