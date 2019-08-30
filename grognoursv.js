const Discord = require('discord.js');
const fs = require('fs');
const path = require('path');
const request = require('request');
const async = require('async');
const URL = require('url');
const bot = new Discord.Client();

// Paths
const modulesPath = path.join(__dirname, 'modules');
const localPath = path.join(__dirname, 'local');
const playlistPath = path.join(__dirname, 'playlist');
const tempFilesPath = path.join(__dirname, 'tempFiles');
const logsPath = path.join(__dirname, 'logs');
const configPath = path.join(__dirname, 'config');

// Modules
const yt = require(path.join(modulesPath, 'youtube.js'));


// Config
const botLogin = require(path.join(configPath, 'botLogin.js'));
const botPreferenceFile = path.join(configPath, 'preference.json');

// Get bot version
try{
	var botVersion = require(path.join(__dirname, 'package.json')).version;
}catch(err) {
	if(err) {
		console.error(new Error('Package.json not found'));
		var botVersion = "#?";
	}	
}

var botPreference = {initcmd: '.', adminGroups: 'admins'};

try{
	botPreference = JSON.parse(fs.readFileSync(botPreferenceFile));
}
catch(err){
	if(err) console.error(err);
	var defaultPreference = {initcmd: '.', adminGroups: 'admin'};
	fs.writeFile(botPreferenceFile, JSON.stringify(defaultPreference, null, '\t'), err =>{
		if(err) console.error(`Failed to write to ${botPreferenceFile}\n${err}`);
	});
}

var adminRoles = botPreference.admingroups;
var initcmd = botPreference.initcmd;
var defaultGame = (process.argv.length > 2)?`${process.argv.slice(2, process.argv.length).join(' ')} | v${botVersion}`:`v${botVersion} | ${initcmd}help`;

// The object voice channel the bot is in
var currentVoiceChannel = null;

// Playback
var queue = [];
var botPlayback;	// stream dispatcher
var voiceConnection;	// voice Connection object
var playing = false;
var stopped = false;
var stayOnQueue = false;
var looping = false;

// Check existence of folders
var folderPaths = [localPath, playlistPath, tempFilesPath, logsPath];
async.each(folderPaths, (path, callback) => {
	fs.access(path, fs.constants.F_OK, err => {
		if(err) {
			if(err.code === 'ENOENT'){
				fs.mkdir(path, err => {
					if(err) callback(err);
					else console.log(`Path created: ${path}\n`);
				});
			}
		}
	});
}, (err) => {
	if(err) console.log(`${err}\n`);
});

// Prints errors to console and also reports error to user
function sendError(title, error, channel){
	console.log("-----"  + "ERROR"+ "------");
	console.log(error);
	console.log("----------");
	channel.send("**" + title + " Erreur**\n```" + error.message +"```");
}

//	Credit: https://stackoverflow.com/questions/1303646/check-whether-variable-is-number-or-string-in-javascript#1303650
function isNumber(obj) {
	return !isNaN(parseFloat(obj))
}

// Command validation
function isCommand(message, command){
	var init = message.slice(0,1);
	var keyword = (message.indexOf(' ') !== -1) ? message.slice(1, message.indexOf(' ')) : message.slice(1);
	if(init === initcmd && keyword.toLowerCase() === command.toLowerCase() ){
		return true;
	}
	return false;
}

// Checks for a specific role the user is in to run admin commands
function isAdmin(message){
	var roles = message.member.roles.array();
	for(var role = 0; role < roles.length; role++){
		for( var i = 0; i < adminRoles.length; i++){
			if(roles[role].name.toLowerCase() === adminRoles[i])
				return true;
		}
	}
	return false;
}

function isOwner(message){
	if(message.member.id === botLogin.owner_id)
		return true
	else
		return false;
}

function getGuildByString(guildName){
	return bot.guilds.filterArray( (guild) =>{
		return guild.name === guildName;
	})[0];
}

function getChannelByString(guild, channelName){
	return guild.channels.filterArray( (channel) =>{
		return channel.name === channelName;
	})[0];
}

function setGame(game){
	bot.user.setActivity(game);
	if(game)
		console.log(`Hello Gamers ^_^ Server Set to ${game}`);
}

// Removes all temporary files downloaded from youtube
function removeTempFiles(){
	fs.readdir(tempFilesPath, (err, files) =>{
		if(err) callback(err);
		async.each(files, (file, callback) =>{
			fs.unlink(path.join(tempFilesPath, file), err =>{
				if(err) return callback(err);
			});
		});
	}, err => {
		if(err) console.error(err);
	});
}

function getDateTime() {

    var date = new Date();

    var hour = date.getHours();
    hour = (hour < 10 ? "0" : "") + hour;

    var min  = date.getMinutes();
    min = (min < 10 ? "0" : "") + min;

    var sec  = date.getSeconds();
    sec = (sec < 10 ? "0" : "") + sec;

    var year = date.getFullYear();

    var month = date.getMonth() + 1;
    month = (month < 10 ? "0" : "") + month;

    var day  = date.getDate();
    day = (day < 10 ? "0" : "") + day;


    return month + "/" + day + "/" + year + "," + hour + ":" + min + ":" + sec;
}

function botUptime(){
	var uptimeSeconds = 0, uptimeMinutes = 0, uptimeHours = 0, uptimeDays = 0;

	uptimeSeconds = Math.floor(bot.uptime/1000);

	if(uptimeSeconds > 60){
		uptimeMinutes = Math.floor(uptimeSeconds/60);
		uptimeSeconds = Math.floor(uptimeSeconds % 60);
	}

	if(uptimeMinutes > 60){
		uptimeHours = Math.floor(uptimeMinutes / 60);
		uptimeMinutes = Math.floor(uptimeMinutes % 60);
	}

	if(uptimeHours > 24){
		uptimeDays = Math.floor(uptimeHours / 24);
		uptimeHours = Math.floor(uptimeHours % 24);
	}

	return [uptimeDays, uptimeHours, uptimeMinutes, uptimeSeconds];
}

/*	Starts playing the first song(index) of the queue
*	After it has passed it checks to see if there is another in queue
*	If there are more songs in queue, the first song is removed after it has been played unless
*	it is set to loop, replay, or stopped
*/
function play(connection, message) {
	const song = queue[0];
	if(!fs.existsSync(song.file)){
		message.channel.send("**ERREUR:** `" + queue[0].title + "` Fichier non trouvé...");
		queue.shift();
	}

	botPlayback = connection.playFile(song.file)
		.on('end', ()=>{
			playing = false;

			if(!stopped){
				if(looping){
					queue.push(queue.shift());
				} else{
					if(!stayOnQueue){
						queue.shift();
					} else
						stayOnQueue = false;
				}

				if(queue.length > 0){
					play(connection, message);
				} else{
					setTimeout(()=>{
						removeTempFiles();
					}, 1500);
				}
			}
		})
		.on('error', (error)=>{
			sendError("Erreur", error, message.channel);
		});
	botPlayback.setVolume(0.5);
	playing = true;
}

// Generate Invite link
function getInvite(callback){
	bot.generateInvite([
		"CONNECT", "SPEAK", "READ_MESSAGES", "SEND_MESSAGES", "SEND_TTS_MESSAGES",
		"ATTACH_FILES", "USE_VAD"
	]).then( link => {
		callback(link);
	});
}

function clearTemp(){
	fs.readdir(tempFilesPath, (error, files) =>{
		if(files.length > 0){
			async.each(files, (file, callback) =>{
				fs.unlinkSync(path.join(tempFilesPath, file));
				callback();
			}, ()=>{
				console.log("Temp Folder cleared");
			});
		}
	});

}

function isYTLink(input){
	/* YT REGEX : https://stackoverflow.com/questions/3717115/regular-expression-for-youtube-links
	*	by Adrei Zisu
	*/
	var YT_REG = /http(?:s?):\/\/(?:www\.)?youtu(?:be\.com\/watch\?v=|\.be\/)([\w\-\_]*)(&(amp;)?‌​[\w\?‌​=]*)?/

	return YT_REG.test(input);
}

bot.on('ready', () => {
	console.log("HathorBot V" + botVersion)
	console.log(bot.user.username + " (" + bot.user.id + ")");

	// display servers
	var guilds = [];
	bot.guilds.array().forEach( (guild) =>{
		guilds.push(guild.name);
	});

	if(guilds.length > 0){
		console.log("Servers:");
		console.log(guilds.join("\n"));
		console.log();
	}

	setGame(defaultGame);

	// Displays invite link if the bot isn't conntected to any servers
	if(bot.guilds.size === 0){
		getInvite(link =>{
			console.log("Invite this bot to your server using this link:\n"  + link);
		});
		console.log();
	}

	clearTemp();
});

bot.on('disconnect', (event) =>{
	console.log("Exited with code: " + event.code);
	if(event.reason)
		console.log("Reason: " + event.reason);

	removeTempFiles();
	process.exit(0);
});

bot.on('message', message => {
	// List admin groups that are allowed to use admin commands
	if(isCommand(message.content, 'listgroupes')){
		if(isOwner(message) || isAdmin(message)){
			var list = [];
			for(var i = 0; i < adminRoles.length; i++){
				list.push("**"+(i+1) + "**. " + adminRoles[i]);
			}
			message.channel.send("**Admin Groupes**", {
				embed: {
					description: list.join('\n'),
					color: 15158332
				}
			});
		}
	}

	// Command to add a certain group to use admin access
	if(isCommand(message.content, 'addgroupe')){
		if(isOwner(message) || isAdmin(message)){
			if(message.content.indexOf(' ') !== -1){
				var group = message.content.split(' ');
				group.splice(0,1);
				group = group.join(" ");

				group = message.guild.roles.find( role => {
					return role.name.toLowerCase() === group.toLowerCase();
				});

				if(!group){
					message.channel.send("Aucun groupe trouvé");
					return;
				}else
					group = group.name.toLowerCase();

				fs.readFile(botPreferenceFile, (error, file) =>{
					if(error) return sendError("Erreur", error, message.channel);

					try{
						file = JSON.parse(file);
					}catch(error){
						if(error) return sendError("Erreur", error, message.channel);
					}

					for(var i = 0; i < file.admingroups.length; i++){
						if(file.admingroups[i] === group)
							return message.channel.send("Ce groupe a déjà été créé");
					}

					file.admingroups.push(group);

					adminRoles = file.admingroups;

					fs.writeFile(botPreferenceFile, JSON.stringify(file, null, '\t'), error =>{
						if(error) return sendError("Erreur", error, message.channel);

						message.channel.send("Groupe `" + group + '` crée');
					});
				});
			}
		} else message.channel.send("Vous n'avez pas accès à cette commande!");
	}

	// Remove a group from admin access
	if(isCommand(message.content, 'remgroupe')){
		if(isOwner(message) || isAdmin(message)){
			if(message.content.lastIndexOf(' ') !== -1){
				var groupName = message.content.split(' ')[1].toLowerCase();

				for(var i = 0; i < adminRoles.length; i++){
					if(groupName === adminRoles[i]){
						adminRoles.splice(i, 1);

						fs.readFile(botPreferenceFile, (err, file)=>{
							if(err) return sendError("Erreur", err, message.channel);

							try{
								file = JSON.parse(file)
							}catch(err){
								if(err) return sendError("Erreur", err, message.channel);
							}

							file.admingroups = adminRoles;

							fs.writeFile(botPreferenceFile, JSON.stringify(file, null, '\t'), err =>{
								if(err) return sendError("Erreur", err, message.channel);
								message.channel.send("Groupe `" + groupName + "` a été effacé.");
							});
						});
					}
				}
			}
		} else message.channel.send("Vous n'avez pas accès à cette commande");
	}

	// Admin Commands
	if(isCommand(message.content, 'setnom')){
		if(isOwner(message) || isAdmin(message)){
			if(message.content.indexOf(' ') !== -1){
				var username = message.content.split(' ')[1];
				bot.user.setUsername(username);
				console.log("DISCORD: Username set to " + username);
			}
		} else message.channel.send("Vous n'avez pas accès à cette commande.");
	}

	if(isCommand(message.content, 'setavatar')){
		if(isOwner(message) || isAdmin(message)){
			if(message.content.indexOf(' ') !== -1){
				var url = message.content.split(' ')[1];
				bot.user.setAvatar(url);
				console.log("DISCORD: Avatar changed");
			}
		} else message.channel.send("Vous n'avez pas accès à cette commande.");
	}

  	if(isCommand(message.content, 'setjeu') && isAdmin(message)){
  		if(isOwner(message) || isAdmin(message)){
				if(message.content.indexOf(' ') !== -1){
	  			var init = message.content.split(' ')[1];
	  			setGame(init);
	  		}
			} else message.channel.send("Vous n'avez pas accès à cette commande");
  	}

  	if(isCommand(message.content, 'exit')){
  		if(isOwner(message) || isAdmin(message)){
				if(currentVoiceChannel)
	  			currentVoiceChannel.leave();
	  		bot.destroy();
			} else message.channel.send("Vous n'avez pas accès à cette commande");
  	}

  	if(isCommand(message.content, 'setprefix')){
  		if(isOwner(message) || isAdmin(message)){
				if(message.content.indexOf(' ') !== -1){
	  			var init = message.content.split(' ')[1];

	  			initcmd = init;

	  			fs.readFile(botPreferenceFile, (error, file) => {
	  				if(error) return sendError("Erreur", error, message.channel);

	  				try{
	  					file = JSON.parse(file);
	  				}catch(error){
	  					if(error) return sendError("Erreur", error, message.channel);
	  				}

	  				file.initcmd = init;

	  				fs.writeFile(botPreferenceFile, JSON.stringify(file, null, '\t'), error =>{
	  					if(error) return sendError("Erreur");

	  					message.channel.send("Prefix modifié: `" + init + "`");
	  				});
	  			});
	  		}
			} else message.channel.send("Vous n'avez pas accès à cette commande.");
  	}
  	// -----------------------------------------------------------------------

  	if(isCommand(message.content, 'source')){
  		message.channel.send("**Source:**1https://discord.gg/QA5rrPs");
  	}

  	if(isCommand(message.content, 'report')){
  		if(message.content.indexOf(' ') !== -1){
  			var user = message.member.user.username;
  			var msg = message.content.split(' ');
  			var report;
  			var reportFile = path.join(logsPath, message.guild.id + '_reports');

  			msg.splice(0,1);
  			msg = msg.join(' ');
  			report = getDateTime() + " " + user + "@"+ message.guild.name + ": " + msg;

  			if(fs.existsSync(reportFile)){
  				fs.readFile(reportFile, 'utf-8', (error, file)=>{
  					if(error) return sendError("Erreur", error, message.channel);
  					file = file.split('\n');
  					file.push(report);
  					fs.writeFile(reportFile, file.join('\n'), error=>{
  						if(error) return sendError("Erreur", error, message.channel);
  						message.channel.send("Votre report a été pris en compte!Merci à vous");
  					});
  				});
  			}else{
  				fs.writeFile(reportFile, report, error =>{
  					if(error) return sendError("Writing Report File", error, message.channel);
  					message.channel.send("You're report has been filed. Thank you");
  				});
  			}
  			console.log("REPORT: " + user + " from " + message.guild.name + " submitted a report.");
  		} else{
  			message.channel.send("o_O ??");
  		}
  	}

		if(isCommand(message.content, 'reports')){
			if(isOwner(message) || isAdmin(message)){
				fs.readdir(logsPath, (error, files)=>{
					if(error) return sendError("Erreur", error, message.channel);

					for(var i = 0; i < files.length; i++){
						if(files[i].split('_')[0] === message.guild.id){
							fs.readFile(path.join(logsPath, files[i]),'utf-8', (error, file)=>{
								if(error) return sendError("Erreur", error, message.channel);

								// Clear the report once it's been read
								if(file === "") return message.channel.send("Aucun report disponible");

								message.channel.send("**Reports**", {
									embed: {
										color: 0xee3239,
										description: file
									}
								});
							});
							return;
						}
					}
					message.channel.send("Aucun report disponible");
				});
			} else message.channel.send("Vous n'avez pas accès à cette commande .");
		}

		if(isCommand(message.content, 'effreports')){
			if(isOwner(message) || isAdmin(message)){
				fs.readdir(logsPath, (error, files) => {
					if(error) return sendError('Erreur', error, message.channel);

					for(var i = 0; i < files.length; i++){
						if(files[i].split('_')[0] === message.guild.id){
							fs.unlink(path.join(logsPath, files[i]), error =>{
								if(error) return sendError("Erreur", error, message.channel);
								message.channel.send("Tous les reports ont été effacé");
							});
							return;
						}
					}
					message.channel.send("Tous les reports ont été effacé");
				})
			} else message.channel.send("Vous n'avez pas accès à cette commande ");
		}

  	if(isCommand(message.content, 'stats')){
  		const users = bot.users.array();
  		const guildMembers = message.guild.members.array();
  		const channels = bot.channels.array();

  		var guildTotalOnline = 0;
  		var totalOnline = 0;
  		var totalTextChannels = 0;
  		var totalVoiceChannels = 0;
  		var uptime = botUptime();

  		for(var i = 0; i < guildMembers.length; i++){
  			if(guildMembers[i].presence.status === 'En ligne'){
  				guildTotalOnline++;
  			}
  		}

  		for(var i = 0; i < users.length; i++){
  			if(users[i].presence.status === 'En ligne'){
  				totalOnline++;
  			}
  		}
  		var nonGuildChannels = 0;
  		for(var i = 0; i < channels.length; i++){
  			if(channels[i].type === 'texte')
  				totalTextChannels++
  			else if(channels[i].type === 'Vocal')
  				totalVoiceChannels++
  			else
  				nonGuildChannels++
  		}

	  	getInvite(link =>{
	  		message.channel.send("**Stats**",{
	  			embed: {
	  				author: {
				      name: bot.user.username,
				      url: link,
				      icon_url: bot.user.displayAvatarURL
				    },
	  				color: 1752220,
	  				fields: [{
	  					name: "Membres",
	  					value: "`" + bot.users.size + "` Total\n`" + totalOnline + "` En Ligne\n\n`" + message.guild.memberCount + "` total sur le serveur\n`" + guildTotalOnline + "` en ligne sur le serveur",
	  					inline: true
	  				}, {
	  					name: "Salons",
	  					value: "`" + (bot.channels.size - nonGuildChannels)+ "` Total\n`" + message.guild.channels.size + "` sur le serveur\n`" + totalTextChannels + "` Total Texte\n`" + totalVoiceChannels + "` Total Vocal",
	  					inline: true
	  				}, {
	  					name: "Servers",
	  					value: bot.guilds.size,
	  					inline: true
	  				}, {
	  					name: "Uptime",
	  					value: uptime[0] + "d " + uptime[1] + "h " + uptime[2] + "m " + uptime[3] + "s",
	  					inline: true
	  				}],
	  				thumbnail: {
						url: bot.user.displayAvatarURL
					}
	  			}
	  		});
	  	});
  	}

  	if(isCommand(message.content, 'apropos')){
  		var owner = message.guild.members.find(member =>{
  			return member.user.username === "Richard"
  		});

  		if(owner){
  			owner = "<@" + owner.id + ">"
  		}else
  			owner = "Richard"

  		getInvite(link =>{
  			message.channel.send("**À propos**", {
	  			embed: {
	  				author: {
				      name: bot.user.username,
				      url: link,
				      icon_url: bot.user.displayAvatarURL
				    },
				    color: 10181046,
	  				fields: [{
	  					name: "Nom",
	  					value: bot.user.username,
	  					inline: true
	  				},{
	  					name: "Version",
	  					value: "|Grognours|" + botVersion,
	  					inline: true
	  				},{
	  					name: "Auteur",
	  					value: "Richard&SimplementAllan",
	  					inline: true
	  				},{
	  					name: "Serveur Propriétaire",
	  					value: "Storybrooke [RP]",
	  					inline: true
	  				},{
	  					name: "Source",
	  					value: "https://discord.gg/QA5rrPs",
	  					inline: false
	  				}],
	  				thumbnail: {
						url: bot.user.displayAvatarURL
					}
	  			}
	  		});
  		});

  	}

  	if(isCommand(message.content, 'help')){
			if(message.content.indexOf(' ') !== -1){
				var prt = message.content.split(' ')[1];

				if(prt.toLowerCase() === 'admin'){
					message.channel.send("**Admin Commandes**", {
						embed: {
							color: 1752220,
							description: "`" + initcmd + "setprefix`: Change le prefix des commandes du bot!\n"+
							"`" + initcmd + "listgroupe`: Liste de tous les groupes administrateurs\n"+
							"`" + initcmd + "addgroupe`: Creer un groupe administrateur\n"+
							"`" + initcmd + "remgroupe`: Effacer un groupe administrateur\n"+
							"`" + initcmd + "setusername`: Changer le nom du bot\n"+
							"`" + initcmd + "setavatar`: Changer l'image de profil du bot\n"+
							"`" + initcmd + "setjeu`: Changer le nom du jeu auquel Grognours joue\n"+
							"`" + initcmd + "reports`: Voir les reports\n"+
							"`" + initcmd + "effreports`: Effacer les reports\n"+
							"`" + initcmd + "exit`: Etteindre le bot\n"
						}
					});
						return;
				}

				if(prt.toLowerCase() === 'general'){
					message.channel.send("**General Commandes**", {
						embed: {
							color: 1752220,
							description: "`" + initcmd+ "apropos`: À propos du bot\n" +
							"`" + initcmd+ "stats`: Voir les statistiques du serveur\n" +
							"`" + initcmd+ "report`: Reporter un problème,bug\n" +
							"`" + initcmd+ "source`: Source du bot\n" +
							"`" + initcmd+ "uptime`: Voir la date de la derniere mise à jour\n" +
							"`" + initcmd+ "invite`: Obtenir un lien pour inviter le bot sur votre serveur\n" 
						}
					});
						return;
				}

			} else{
				message.channel.send("**Commands**", {
					embed: {
						color: 1752220,
						description: "**Admin Commandes**\n" +
						"`" + initcmd + "help admin`: Voir les commandes administrateurs\n"+
						"`" + initcmd + "help general`: Voir les commandes générales\n"
					}
				});
			}
  	}

  	if(isCommand(message.content, 'invite')){
  		getInvite(link => {
  			message.channel.send("**Invite:** "  + link);
  		});
  	}

  	if(isCommand(message.content, 'uptime')){
  		var uptime = botUptime();
  		var d = uptime[0], h = uptime[1], m = uptime[2], s = uptime[3];

  		message.channel.send("**Uptime:** " + d + " day(s) : " + h + " hours(s) : " + m + " minute(s) : " + s + " second(s)");
  	}

  	if(isCommand(message.content, 'setvc')){
  		if(message.content.indexOf(" ") !== -1){
  			var voiceChannelName = message.content.split(" ")[1];

  			var guild = message.member.guild;
  			var channel = getChannelByString(guild, voiceChannelName);

  			function writeOutChannels(){
  				fs.writeFile(defaultChannelPath, JSON.stringify(defaultChannel, null, '\t'), () =>{
		  			message.channel.send("Le channel vocal prioritaire a été defini en" + voiceChannelName);
		  		});
  			}

  			if(channel){
  				defaultChannel.name = voiceChannelName;
				defaultChannel.guild = guild.name;
				defaultChannel.voiceID = channel.id;
				defaultChannel.guildID = guild.id;
				writeOutChannels();
  			} else
  			  	message.channel.send("Aucun salon vocal trouvé");
  		}
  	}

  	if(isCommand(message.content, 'join')){
  		var userVoiceChannel = message.member.voiceChannel;
  		if(userVoiceChannel){
  			if(!playing){
  				if(currentVoiceChannel){
	  				currentVoiceChannel.leave();
	  				currentVoiceChannel = null;
	  			 }
  				userVoiceChannel.join();
  				currentVoiceChannel = userVoiceChannel;
		  	} else
		  		message.channel.send("Actuellement joue quelque chose");
  		}
  		else
  			message.channel.send("Vous n'etes pas dans un salon vocal");
  	}

  	if(isCommand(message.content, 'queue') || isCommand(message.content, 'playing') || isCommand(message.content, 'q')){
  		var songs = [];
  		for (var i = 0; i < queue.length; i++) {
  			songs.push(queue[i].title);
  		}

  		if(songs.length > 0){
  			if(songs.length === 1){
  				if(looping){
  					message.channel.send("**Liste d'attente - Playlist\t[LOOPING]**\n**Playing:** " + songs[0]);
  				} else
  					message.channel.send("**Liste d'attente - Playlist**\n**Playing:** " + songs[0]);
  			} else{
  				var firstSong = songs.shift();
  				for (var i = 0; i < songs.length; i++) {
  					songs[i] = "**" + (i+1) + ". **"+ songs[i];
  				}
  				if(looping){
  					message.channel.send("**Liste d'attente - Playlist\t[LOOPING]**\n**Playing:** " + firstSong + "\n\n" + songs.join("\n"));
  				} else
  					message.channel.send("**Liste d'attente - Playlist**\n**Playing:** " + firstSong + "\n\n" + songs.join("\n"));
  			}
  		} else
  			message.channel.send("Aucune musique en attente");
  	}

  	if(isCommand(message.content, 'local') || isCommand(message.content, 'l')){
  		fs.readdir(localPath, (error, files) =>{
  			if(error) return sendError("Erreur", error, message.channel);
  			for(var i = 0; i < files.length; i++){
  				files[i] = "**" + (i+1) + ".** " + files[i].split(".")[0];
  			}

  			message.channel.send("**Musiques sauvegardées**", {
  				embed: {
  					color: 10181046,
  					description: files.length > 0 ? files.join("\n") : "Rien n'a été trouvé"
  				}
  			});
  		});
  	}

  	if(isCommand(message.content, 'play') || isCommand(message.content, 'p')){
  		var file = message.attachments.first();

  		// Handle playing audio for a single channel
  		if(playing && currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Joue déjà quelque chose dans un autre salon vocal");
			return;
		}

		if(!message.member.voiceChannel){
			message.channel.send("Vous n'etes pas dans un salon vocal!");
			return;
		}

		if(currentVoiceChannel !== message.member.voiceChannel){
			if(currentVoiceChannel) currentVoiceChannel.leave();

			currentVoiceChannel = message.member.voiceChannel;
			if(playing){
				message.channel.send("Joue quelque chose");
				return;
			}
		}

		function pushPlay(title, fPath, local, id, URL){
			if(id && URL){
				queue.push({
			 		title: title,
			 		id: id,
			 		file: fPath,
			 		local: local,
			 		url: URL
			 	});
			} else if(!id && !URL){
				queue.push({
			 		title: title,
			 		file: fPath,
			 		local: local
			 	});
			}

		 	if(!playing){
		 		message.channel.send("**Joue:** " + title);
		 		currentVoiceChannel.join().then( connection => {
					voiceConnection = connection;
					play(connection, message);
				});
		 	} else{
		 		message.channel.send("**Ajouté à la liste d'attente:**\n" + title);
		 	}
		}

		// Play audio by file
		if(file){
			if(stopped){
				stopped = false;
	  			stayOnQueue = false;
	  			queue.splice(0,1);
	  	}

			var ext = file.filename.split('.');
			ext = ext[ext.length - 1];
			if(ext !== 'mp3'){
				message.channel.send("Fichier mp3 uniquement");
				return;
			}

			var fileName = file.filename.replace(/[&\/\\#,+()$~%'":*?<>{}|_-]/g,'');
			var filePath = path.resolve(tempFilesPath, fileName);
			var title = fileName.slice(0, fileName.lastIndexOf('.'));

			if(fs.existsSync(filePath)){
				pushPlay(title, filePath, false);
			 } else{
			 	var stream = request.get(file.url);

				stream.on('error', error => {
					if(error) return sendError("Erreur", error, message.channel);
				});

				stream.pipe(fs.createWriteStream(filePath));

				stream.on('complete', () =>{
					pushPlay(title, filePath, false);
				});
			}
		} else if(message.content.indexOf(' ') !== -1){
			var input = message.content.split(' ')[1];
			var qUrl = URL.parse(input, true);
			var isLink = isYTLink(input);

			if(stopped){
				stopped = false;
	  			stayOnQueue = false;
	  			queue.splice(0,1);
	  		}

			// Play audio by non-youtube url link
			if( qUrl.hostname !== null && qUrl.hostname !== "www.youtube.com" && qUrl.hostname !== "youtu.be"){
				if(input.endsWith('.mp3')){
					var file = input.slice(input.lastIndexOf('/') + 1).replace(/[&\/\\#,+()$~%'":*?<>{}|_-]/g,'');
					var filePath = path.join(tempFilesPath, file);
					var title = file.slice(0, file.lastIndexOf('.'));

					if(fs.existsSync(filePath)){
						pushPlay(title, filePath, false);
					 } else{
					 	var stream = request.get(input);

					 	stream.on('response', response =>{
					 		if(response.statusCode === 404){
					 			message.channel.send("Aucun fichier valable trouvé via ce lien. Assurez vous de sa fiabilité");
					 		}else{
					 			stream.pipe(fs.createWriteStream(filePath));
					 		}
					 	});

						stream.on('error', error => {
							if(error) return sendError("Erreur", error, message.channel);
						});

						stream.on('complete', () =>{
							if(fs.existsSync(filePath)){
								pushPlay(title, filePath, false);
							}
						});
					}
				} else
					message.channel.send("Aucun fichier valable trouvé via ce lien. Assurez vous de sa fiabilité");
			} else if(isLink){ 
				// Play audo by YTURL
				var url = message.content.split(' ')[1];
				yt.getInfo({url: url, temp: tempFilesPath})
				.then(song => {
					yt.getFile({url: url, path: song.path})
					.then(() => {
						pushPlay(song.title, song.path, false, song.id, url);
					})
					.catch( err => {
						throw err
					})					
				})
				.catch(err => {
					if(err) sendError("Problème lié à Youtube", err, message.channel);
				})
			} else{
				// Play audio file by index number
				var indexFile = message.content.split(' ')[1];
				if(isNumber(indexFile)){
					indexFile = Number(indexFile);
					fs.readdir(localPath, (error, files) =>{
						if(error) return sendError("Erreur", error, message.channel);
						for(var i = 0; i < files.length; i++){
							if( indexFile === (i+1)){
								var title = files[i].split('.')[0];
								var file = path.join(localPath, files[i]);

								pushPlay(title, file, true);
								return;
							}
						}
						message.channel.send("Aucune musique sauvegardée trouvé via les informations fournises");
					});
				} else{
					input = message.content.split(' ');
					input.shift();

					// Playing a playlist
					if(input[0] === 'playlist' || input[0] === 'pl'){
						var pl = input[1];
						fs.readdir(playlistPath, (error, files) =>{
							if(error) return sendError("Erreur", error, message.channel);

							if(isNumber(pl)){
								pl = Number(pl);
							} else
								pl = pl.toLowerCase();

							async.eachOf(files, (file, index, callback)=>{
								if((index+1) === pl || files[index].split('.')[0].toLowerCase() === pl){
									try{
										var playlist = fs.readFileSync(path.join(playlistPath, files[index]));
										playlist = JSON.parse(playlist);
									}catch(error){
										if(error) return sendError("Erreur", error, message.channel);
									}

									message.channel.send("Chargement `" + files[index].split('.')[0] + '` playlist dans la liste desormais');

									async.eachSeries(playlist, (song, callback) =>{
										var title = song.title;
										var URL = song.url;
										var id = song.id;
										var local = song.local;

										if(song.local){
											queue.push({
												title: title,
												file: song.file,
												local: true
											});

											if(queue.length === 1){
												if(!playing){
											 		message.channel.send("**Joue:** " + title);
											 		currentVoiceChannel.join().then( connection => {
														voiceConnection = connection;
														play(connection, message);
													});
											 	}
											}
										} else{
											yt.getInfo(URL, (error, rawData, id, title, length_seconds) =>{
												if(error) return callback(error);
												var filePath = path.join(tempFilesPath, id + '.mp3');

												yt.getFile(URL, filePath, ()=>{
													queue.push({
														title: title,
														file: filePath,
														id: id,
														url: URL,
														local: false
													});

													if(queue.length === 1){
														if(!playing){
													 		message.channel.send("**Joue:** " + title);
													 		currentVoiceChannel.join().then( connection => {
																voiceConnection = connection;
																play(connection, message);
															});
													 	}
													}
												});
											});
										}
										callback(null);
									}, err =>{
										if(err) return sendError("Probleme Youtube", err, message.channel);
									});
								}
							}, err=>{
								if(err) return sendError(err, err, message.channel);
							});
						});
					}else{
						//	Play Youtube by search
						input = input.join();						
						yt.search(input).then(searchResults => {
							var song = {}
							if(searchResults.length === 0){
								message.channel.send("Impossible de trouver un résultat via les informations données.");
								return;
							}
							song.id = searchResults[0].id;
							song.title = searchResults[0].title;
							song.url = searchResults[0].url;
							song.path = path.join(tempFilesPath, searchResults[0].id + '.mp3' );
							
							yt.getFile({url: song.url, path: song.path}).then(() =>{
								pushPlay(song.title, song.path, false, song.id, song.url);
							}).catch(err => {
								throw err
							});
						}).catch(err => {
							if(err) sendError('Problème lié à Youtube', err, message.channel);
						});
					}
				}
			}
  		} else{
  			if(queue.length > 0){
  				if(!playing){
  					currentVoiceChannel.join().then( connection => {
  						voiceConnection = connection;
  						play(voiceConnection, message);
  					});
  				} else
  					message.channel.send("Joue déjà une musique");
  			}
  			else
  				message.channel.send("Aucune musique dans la liste d'attente");
  		}
  	}

  	if(isCommand(message.content, 'stop')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'êtes pas dans le canal vocal du bot");
  			return;
  		}

  		if(playing){
  			playing = false;
  			stayOnQueue = true;
  			stopped = true;
  			botPlayback.end();
  		} else
  			message.channel.send("Rien à arreter");
  	}

  	if(isCommand(message.content, 'skip')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'etes pas dans le salon vocal du bot");
  			return;
  		}

  		if(playing){
  			var prevSong = queue[0].title;
  			playing = false;
  			stayOnQueue = false;
  			botPlayback.end();
  			if(queue.length > 0)
  				message.channel.send("**Zapper:** " + prevSong + "\n**Joue:** " + queue[0].title);
  			else
  				message.channel.send("**Zapper:** " + prevSong);
  		} else{
  			if(queue.length > 0){
  				var prevSong = queue[0].title;

  				if(stayOnQueue)
  					stayOnQueue = false;
  				queue.shift();
  				message.channel.send("**Zapper:** " + prevSong + "\n**Joue:** " + queue[0].title);
  				play(voiceConnection, message);
  			} else{
  				message.channel.send("Rien à zapper");
  			}
  		}
  	}

  	if(isCommand(message.content, 'replay')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'etes pas dans le salon vocal du bot");
  			return;
  		}

  		if(playing){
  			playing = false;
  			stayOnQueue = true;
  			botPlayback.end();
  		} else
  			message.channel.send("Besoin de jouer une musique pour la rejouer");
  	}

  	if(isCommand(message.content, 'remove')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'etes pas dans le salon vocal du bot");
  			return;
  		}

  		if(message.content.indexOf(' ') !== -1){
  			var param = message.content.split(' ')[1];

  			if(param === "all"){
  				if(!playing){
  					queue = [];
  					removeTempFiles();
  				} else{
  					queue.splice(1, queue.length - 1);
  				}
  				message.channel.send("Toutes les musiques ont été effacé de la liste d'attente");
  				return;
  			}

  			if(param.indexOf(',') !== -1){
  				param = param.split(',');
  			}else{
  				param = [param];
  			}
  			for(var i = 0; i < param.length; i++){
  				if(isNumber(param[i])){
  					param[i] = Number(param[i]);
  				}else{
  					message.channel.send("Une des informations données n'est pas un chiffre!");
  					return;
  				}
  			}

  			var list = [];
  			for(var x = 0; x < param.length; x++){
  				for(var y = 1; y < queue.length; y++){
  					if(param[x] === y){
  						list.push(queue[y]);
  					}
  				}
  			}

  			for(var i = 0; i < list.length; i++){
  				for(var x = 1; x < queue.length; x++){
  					if(list[i].title === queue[x].title){
  						var title = queue[x].title;
						queue.splice(x, 1);
						message.channel.send("**Effacé:** `" + title + "` de la liste");
  					}
  				}
  			}
  		}
  	}

  	if(isCommand(message.content, 'save')){
	  	if(message.content.indexOf(' ') !== -1){
			var url = message.content.split(' ')[1];
			yt.getInfo({url: url, local: localPath})
			.then(song => {
				song.title = song.title.replace(/[&\/\\#,+()$~%.'":*?<>{}|]/g,'');
				yt.getFile(song)
				.then(song => {
				message.channel.send("**Sauvegarder:** *" + song.title + "*");
				})
			})
			.catch(err => {
				if(err) sendError("Youtube Information Erreur", error, message.channel);
			});
	  	}
	  	else{
	  		if(playing){
	  			var song = queue[0];
		  		var title = song.title.replace(/[&\/\\#,+()$~%.'":*?<>{}|]/g,'');
			  	var output = './local/' + title + '.mp3';
	  			if(!song.local){
		  			if(!fs.existsSync(output)){
		  				fs.createReadStream(song.file).pipe(fs.createWriteStream(output));
		  				message.channel.send("**Sauvegarder:** *" + title + "*");
		  			} else{
		  				message.channel.send("Cette musique est déjà sauvegardé")
		  			}
		  		} else{
		  			message.channel.send("Vous avez déjà sauvegardé cette musique");
		  		}
	  		} else{
	  			message.channel.send("Ne jouez rien pour sauvegarder");
	  		}
	  	}
  	}

  	if(isCommand(message.content, 'remlocal')){
  		var index = Number(message.content.split(' ')[1]);

  		fs.readdir(localPath, (error, files) =>{
  			if(error) return sendError("Musique sauvegardée,effacée", error, message.channel);
  			for (var i = 0; i < files.length; i++) {
	  			if((i+1) === index){
	  				if(!playing){
	  					fs.unlinkSync(path.join(localPath, files[i]));
	  					message.channel.send("Effacée " + files[i].split('.')[0]);
	  					return;
	  				} else{
	  					if(files[i] !== queue[0].title + '.mp3'){
	  						fs.unlinkSync(path.join(localPath, files[i]));
	  						message.channel.send("Effacée " + files[i].split('.')[0]);
	  						return;
	  					}
	  				}
	  			}
  			}
  			message.channel.send("Aucune réponse trouvée via les informations données");
  		});
  	}

  	if(isCommand(message.content, 'readd')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'êtes pas dans le salon vocal du bot");
  			return;
  		}

  		if(queue.length > 0){
  			var newSong = queue[0];
			queue.push(newSong);
			message.channel.send("**Rajouter à la liste** " + newSong.title);
  		} else
  			message.channel.send("Aucune musique à reajouter.");
  	}

  	if(isCommand(message.content, 'loop')){
  		if(currentVoiceChannel !== message.member.voiceChannel){
			message.channel.send("Vous n'etes pas dans le cannal vocal du bot");
  			return;
  		}

	  	if(!looping){
	  		looping = true;
	  		message.channel.send("Looping `ON`");
	  	} else{
	  		looping = false;
	  		message.channel.send("Looping `OFF`");
	  	}
  	}

  	if(isCommand(message.content, 'playlist') || isCommand(message.content, 'pl')){
  		if(message.content.indexOf(' ') !== -1){
  			var param = message.content.split(' ')[1];

  			if(isNumber(param)){
  				param = Number(param);
  				fs.readdir(playlistPath, (error, files) => {
  					if(error) return sendError("Erreur", error, message.channel);

  					for(var i = 0; i < files.length; i++){
  						if((i+1) === param){
  							try{
								var playlist = fs.readFileSync(path.join(playlistPath, files[i]));
								var playlist = JSON.parse(playlist);
  							}catch(error){
  								if(error) return sendError("Erreur", error, message.channel);
  							}

  							var playlistTitle = files[i].split('.')[0];
							var songs = [];

							for(var i = 0; i < playlist.length; i++){
								songs.push("**" + (i+1) + ".** " + playlist[i].title);
							}

							message.channel.send("**Playlist - " + playlistTitle + "**\n" + songs.join("\n"));
  						}
  					}
  				});
  			} else{
  				if(param.toLowerCase() === 'save'){
  					if(message.content.indexOf(' ', message.content.indexOf('save')) !== -1){
  						var playlistName = message.content.split(' ');
  						playlistName.splice(0,2);
  						playlistName = playlistName.join(' ');
  						var playlist = [];

  						if(queue.length === 0)
  							return message.channel.send("Aucune musique à sauvegarder");

  						for(var i = 0; i < queue.length; i++){
  							if(queue[i].local){
  								playlist.push({
  									title: queue[i].title,
  									file: queue[i].file,
  									local: queue[i].local
  								});
  							} else{
  								playlist.push({
  									title: queue[i].title,
  									url: queue[i].url,
  									id: queue[i].id,
  									local: false
  								});
  							}
  						}

  						fs.readdir(playlistPath, (error, files) =>{
  							if(error) return sendError("Erreur", error, message.channel);

  							for(var i = 0; i < files.length; i++){
  								var fileName = files[i].split('.')[0];
  								if(fileName.toLowerCase() === playlistName.toLowerCase()){
  									message.channel.send("Il y a déjà une playlist à ce nom");
  									return;
  								}
  							}

  							fs.writeFile(path.join(playlistPath, playlistName + '.json'), JSON.stringify(playlist, null, '\t'), error =>{
	  							if(error) return sendError("Erreur", error, message.channel);
	  							message.channel.send("Playlist `" + playlistName + '` sauvegarder');
	  						});
  						});
  					}
  					return;
  				}

  				if(param.toLowerCase() === 'remove'){
  					if(message.content.indexOf(' ', message.content.indexOf('remove')) !== -1){
  						var playlistIndex = message.content.split(' ')[2];
  						var trackIndex = message.content.split(' ')[3];

  						if(!isNumber(playlistIndex)){
  							message.channel.send('Merci de communiquer un chiffre lié à la playlist voulue')
  							return;
  						} else playlistIndex = Number(playlistIndex);

  						if(trackIndex){
  							if(isNumber(trackIndex)){
  								trackIndex = Number(trackIndex);
  								fs.readdir(playlistPath, (error, files) =>{
  									if(error) return sendError("Erreur", error, message.channel);
  									for(var i = 0; i < files.length; i++){
  										if((i+1) === playlistIndex){
  											var playlistFile = files[i];
  											var playlistFileName = files[i].split('.')[0];

  											fs.readFile(path.join(playlistPath, playlistFile), (error, file)=>{
  												try{
  													file = JSON.parse(file);
  												} catch(error){
  													if(error) return sendError("Erreur", error, message.channel);
  												}

  												if(trackIndex > file.length || trackIndex <= 0){
  													return message.channel.send('Merci de donner un chiffre valable')
  												}

  												var titleTrack = file[trackIndex-1].title;
  												file.splice(trackIndex - 1, 1);
  												if(file.length === 0){
  													message.channel.send("Envisager de supprimer la playlist à la place");
  													return;
  												}
  												fs.writeFile(path.join(playlistPath, playlistFile), JSON.stringify(file, null, '\t'), error =>{
  													if(error) return sendError("Erreur", error, message.channel);
  													message.channel.send('**Playlist**\nMusique `' + titleTrack +  '` a été effacé `' + playlistFileName + '` playlist')
  												});
  											});
  										}
  									}
  								});
  							} else{
  								message.channel.send('Entrez un chiffre lié à l`information voulue');
  								return;
  							}
  							return;
  						}

  						fs.readdir(playlistPath, (error, files) => {
  							if(error) return sendError("Erreur", error, message.channel);
  							for(var i = 0; i < files.length; i++){
  								if((i+1) === playlistIndex){
  									var title = files[i].split('.')[0];
  									fs.unlink(path.join(playlistPath, files[i]), error =>{
  										if(error) return sendError("Lien invalide", error, message.channel);
  										message.channel.send("Playlist `" + title + "` effacée");
  									});
  									return;
  								}
  							}
  							message.channel.send("Aucune playlist trouvée");
  						});
  					}
  					return;
  				}

  				if(param.toLowerCase() === 'add'){
  					if(message.content.indexOf(' ', message.content.indexOf('add')) !== -1){
  						var playListIndex = message.content.split(' ')[2];
  						var link = message.content.split(' ')[3];

  						if(isNumber(playListIndex)){
  							playListIndex = Number(playListIndex);
  							if(link){
  								if(!isYTLink(link)){
  									message.channel.send("Lien YouTube Invalide");
  									return;
  								}

  								fs.readdir(playlistPath, (err, files) =>{
  									if(err) return sendError("Erreur", err, message.channel);
  									async.eachOf(files, (file, index) =>{
  										if((index + 1) === playListIndex){
  											fs.readFile(path.join(playlistPath, file), (err, pl) =>{
  												if(err) return sendError("Erreur", err, message.channel);
  												try{
  													pl = JSON.parse(pl);
  												} catch(err){
  													if(err) return sendError("Erreur", err, message.channel);
  												}

  												yt.getInfo(link, (error, rawData, id, title) =>{

  													async.each(pl, (song, callback) =>{
	  													if(song.id === id || song.url === link || song.title === title){
	  														callback(new Error("Déjà dans la playlist"));
	  													} else {
	  														callback(null);
	  													}
	  												}, err =>{
	  													if(err) return sendError(err, err, message.channel);

	  													pl.push({
	  														title: title,
	  														id: id,
	  														url: link,
	  														local: false
	  													});

	  													fs.writeFile(path.join(playlistPath, file), JSON.stringify(pl, null, '\t'), err =>{
	  														if(err) return sendError("Erreur", err, message.channel);

	  														message.channel.send("*" + title +"*\n a été ajouté `" + file.split('.')[0] + "` playlist");
	  													});
	  												});


  												});

  											});
  										}
  									});
  								});
  							}else {
  								message.channel.send("Aucun URL fourni");
  							}
   						} else{
  							message.channel.send("Aucun index donné. Veuillez réessayer");
  						}
  					}
  					return;
  				}

  				if(param.toLowerCase() === 'rename'){
  					if(message.content.indexOf(' ', message.content.indexOf('rename')) !== -1){
  						var playlistName = message.content.split(' ')[2];
  						var newPlaylistName = message.content.split(' ')[3];

  						if(!newPlaylistName){
  							message.channel.send("Aucun nom de playlist fourni");
  							return;
  						}

  						if(isNumber(playlistName)){
  							playlistName = Number(playlistName);
  						}

  						var e = /^[a-zA-Z0-9_]*$/;
  						if(!e.test(newPlaylistName)){
  							message.channel.send("Aucun symbole autorisé!");
  							return;
  						}

  						fs.readdir(playlistPath, (err, files) =>{
  							if(err) return sendError("Erreur", err, message.channel);

  							for(var i = 0; i < files.length; i++){
  								if(files[i].split('.')[0].toLowerCase() === (isNumber(playlistName) ? playlistName : playlistName.toLowerCase()) || (playlistName - 1) === i){
  									var oldPlPath = path.join(playlistPath, files[i]);
  									var newPlPath = path.join(playlistPath, newPlaylistName + '.json');
  									fs.rename(oldPlPath, newPlPath, (err)=>{
  										if(err) return sendError("Erreur", err, message.channel);
  										message.channel.send("Playlist `" + files[i].split('.')[0] + "` a été renommé `" + newPlaylistName + "`");
  									});
  									return;
  								}
  							}
  							message.channel.send("Playlist `" + files[i].split('.')[0] + "` introuvable");
  						});
  					} else{
  						message.channel.send("Aucun nom fourni");
  					}
  				}
  			}
  		} else {
  			fs.readdir(playlistPath, (error, files) =>{
  				if(error) return sendError("Erreur", error, message.channel);
  				for(var i = 0; i < files.length; i++){
  					files[i] = "**" + (i+1) + ".** " + files[i].split('.')[0];
  				}

  				if(files.length > 0)
  					message.channel.send("**Playlist**\n" + files.join("\n"));
  				else {
  					message.channel.send("Aucune playlist sauvegardée");
  				}
  			});
  		}
  	}
});

bot.on('voiceStateUpdate', (oldMember, newMember) =>{
	if(newMember.id === bot.user.id){
		newMember.voiceChannel = currentVoiceChannel;
	}

	if(currentVoiceChannel && oldMember.voiceChannel){
		if(oldMember.voiceChannel === currentVoiceChannel && newMember.voiceChannel !== currentVoiceChannel  && currentVoiceChannel.members.size === 1){
			if(queue.length > 0){
				queue.splice(0, queue.length);
			}

			if(playing){
				botPlayback.end();
				playing = false;
				stopped = false;
				looping = false;
				stayOnQueue = false;
			}

			currentVoiceChannel.leave();
		}
	}
});

bot.login(botLogin.token);
