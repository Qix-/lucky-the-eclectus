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
const adminID = env('DISCORD_ADMIN_ID');

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

async function doChatter(chid, schedule=true) {
	const ch = client.channels.cache.get(chid);
	if (!isParticipatingChannel(ch)) {
		schedules.delete(chid);
		return;
	}

	let schMessage = '(not rescheduled)';
	if (schedule) {
		const nextDelay = genTimeoutMS();
		schMessage = chalk`(next in {yellow ${ms(nextDelay.ms)} ({green ${nextDelay.type}})})`;
		scheduleChatter(chid, nextDelay);
	}

	if (speechDB.length > 0) {
		const term = generateSpeech();
		await ch.send(`_${term}_`);
		console.log(chalk`{dim 🦜 {magenta ${ch.guild.name}}#{cyan ${ch.name}} "${term}" ${schMessage}}`);
	} else {
		console.log(`WARNING: no phrases in database; nothing to send to channel ${schMessage}`);
	}
}

const schedules = new Map();

function scheduleChatter(chid, delay) {
	if (schedules.has(chid)) clearTimeout(schedules.get(chid));

	delay = delay || genTimeoutMS();
	const {ms: msdelay} = delay;
	const tohndl = setTimeout(doChatter, msdelay, chid);
	schedules.set(chid, tohndl);
}

function initialSchedule(ch) {
	const id = ch.id;
	const delay = genTimeoutMS(true);
	scheduleChatter(id, delay);
	console.log(chalk`{dim scheduled {magenta ${ch.guild.name}}#{cyan ${ch.name}} in {yellow ${ms(delay.ms)}} ({green long})}`);
}

const isParticipatingChannel = ch => ch && ch.viewable && ch.type === 'text' && ch.permissionsFor(client.user.id).has('SEND_MESSAGES');

function *participatingChannels() {
	for (const [id, ch] of client.channels.cache.entries()) {
		if (isParticipatingChannel(ch)) {
			yield [id, ch];
		}
	}
}

const commands = {
	'add': async ({msg, raw}) => {
		addSpeech(raw);
		await msg.react('✅');
		await msg.reply(`added: _"${raw}"_`);
	},
	'poke': async ({msg}) => {
		const pchans = [...participatingChannels()];
		const total = pchans.length;
		let i = 0;
		const status = await msg.reply(`0 / ${total}`);

		for (const [id, ch] of pchans) {
			++i;
			await status.edit(`${i} / ${total} (${id})`);
			await doChatter(id, false); // do not schedule
		}

		await status.edit(`${total} / ${total} (done!)`);
	}
};

client.on('ready', () => {
	console.log(chalk`logged in as {bold.keyword('lime') ${client.user.tag}}!`);

	// Set up initial timeouts
	for (const [_, ch] of participatingChannels()) {
		initialSchedule(ch);
	}
});

client.on('message', async msg => {
	const isOwner = msg.member && msg.member.id === adminID;

	if (isOwner && msg.mentions.has(client.user) && msg.type === 'DEFAULT') {
		const match = msg.content.match(/^<@!(\d+)>\s*(\w+)(?:\s+(.+?))?\s*$/);
		if (!match || match[1] !== client.user.id || !commands[match[2]]) {
			await msg.react('⁉️');
			return;
		}

		const raw = match[3] || '';
		const args = raw.trim().split(/[\t\s]+/g);
		console.log(chalk`{magenta.bold ADMIN ({red ${msg.member.displayName} {dim ${msg.member.id}}}):} {cyan !${match[2]}} ${raw}`);
		await commands[match[2]]({msg, raw, args});
	}
});

client.on('guildCreate', async g => {
	console.log(chalk`🎉 added to server: {magenta.bold ${g.name}}`);
	for (const [_, ch] of g.channels.cache.entries()) {
		if (isParticipatingChannel(ch)) {
			initialSchedule(ch);
		}
	}
});

client.on('guildDelete', async g => {
	console.log(chalk`😭 removed from server: {magenta.bold ${g.name}}`);
	for (const [id, ch] of g.channels.cache.entries()) {
		if (isParticipatingChannel(ch) && schedules.has(id)) {
			clearTimeout(schedules.get(id));
			schedules.delete(id);
			console.log(chalk`{dim unscheduled {magenta ${ch.guild.name}}#{cyan ${ch.name}}}`);
		}
	}
});

client.login(env('DISCORD_TOKEN'));
