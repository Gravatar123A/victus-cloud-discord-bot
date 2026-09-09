import { EmbedBuilder } from 'discord.js';
export class PrefixInteraction {
    id;
    client;
    message;
    user;
    member;
    guild;
    guildId;
    channel;
    channelId;
    options;
    commandName;
    deferred = false;
    replied = false;
    replyMessage = null;
    constructor(message, commandName, args, commandData) {
        this.id = message.id;
        this.client = message.client;
        this.message = message;
        this.user = message.author;
        this.member = message.member;
        this.guild = message.guild;
        this.guildId = message.guildId;
        this.channel = message.channel;
        this.channelId = message.channelId;
        this.commandName = commandName;
        this.options = this.buildOptionsResolver(args, commandData);
    }
    buildOptionsResolver(args, commandData) {
        const optionsMap = new Map();
        let subcommand = null;
        let subcommandGroup = null;
        const optionsList = commandData.options || [];
        const hasSubcommands = optionsList.some((opt) => opt.type === 1 || opt.type === 2);
        let remainingArgs = [...args];
        if (hasSubcommands && remainingArgs.length > 0) {
            const possibleSub = remainingArgs[0].toLowerCase();
            const subOpt = optionsList.find((opt) => opt.name.toLowerCase() === possibleSub);
            if (subOpt) {
                if (subOpt.type === 1) { // SUB_COMMAND
                    subcommand = subOpt.name;
                    remainingArgs.shift();
                    const subOptions = subOpt.options || [];
                    this.mapArgsToOptions(remainingArgs, subOptions, optionsMap);
                }
                else if (subOpt.type === 2) { // SUB_COMMAND_GROUP
                    subcommandGroup = subOpt.name;
                    remainingArgs.shift();
                    if (remainingArgs.length > 0) {
                        const possibleSub2 = remainingArgs[0].toLowerCase();
                        const subOpt2 = subOpt.options?.find((opt) => opt.name.toLowerCase() === possibleSub2);
                        if (subOpt2 && subOpt2.type === 1) {
                            subcommand = subOpt2.name;
                            remainingArgs.shift();
                            const subOptions = subOpt2.options || [];
                            this.mapArgsToOptions(remainingArgs, subOptions, optionsMap);
                        }
                    }
                }
            }
        }
        else {
            this.mapArgsToOptions(remainingArgs, optionsList, optionsMap);
        }
        return {
            getString: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined && required)
                    throw new Error(`Missing option ${name}`);
                return val !== undefined ? String(val) : null;
            },
            getBoolean: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined)
                    return null;
                return val === true || String(val).toLowerCase() === 'true' || String(val) === '1' || String(val).toLowerCase() === 'yes';
            },
            getInteger: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined)
                    return null;
                const parsed = parseInt(String(val), 10);
                return isNaN(parsed) ? null : parsed;
            },
            getNumber: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined)
                    return null;
                const parsed = parseFloat(String(val));
                return isNaN(parsed) ? null : parsed;
            },
            getUser: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined && required)
                    throw new Error(`Missing option ${name}`);
                if (!val)
                    return null;
                const id = val.replace(/[<@!>]/g, '');
                const resolved = this.client.users.cache.get(id) || this.message.mentions.users.get(id) || null;
                if (resolved === null && required)
                    throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getRole: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined && required)
                    throw new Error(`Missing option ${name}`);
                if (!val || !this.guild)
                    return null;
                const id = val.replace(/[<@&>]/g, '');
                const resolved = this.guild.roles.cache.get(id) || this.message.mentions.roles.get(id) || null;
                if (resolved === null && required)
                    throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getChannel: (name, required) => {
                const val = optionsMap.get(name);
                if (val === undefined && required)
                    throw new Error(`Missing option ${name}`);
                if (!val || !this.guild)
                    return null;
                const id = val.replace(/[<#>]/g, '');
                const resolved = this.guild.channels.cache.get(id) || this.message.mentions.channels.get(id) || null;
                if (resolved === null && required)
                    throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getSubcommand: (required) => subcommand,
            getSubcommandGroup: (required) => subcommandGroup,
        };
    }
    mapArgsToOptions(args, optionsSchema, optionsMap) {
        optionsSchema.forEach((opt, index) => {
            if (args[index] !== undefined) {
                optionsMap.set(opt.name, args[index]);
            }
        });
    }
    normalizeResponse(options) {
        return translateV2Components(options);
    }
    async deferReply(options) {
        if (this.deferred || this.replied)
            return;
        this.deferred = true;
        this.replyMessage = await this.message.reply({ content: '⏳ Processing...' }).catch(async () => {
            return this.message.channel.send({ content: '⏳ Processing...' });
        });
    }
    async reply(options) {
        if (this.replied || this.deferred) {
            return this.editReply(options);
        }
        this.replied = true;
        const normalized = this.normalizeResponse(options);
        this.replyMessage = await this.message.reply(normalized).catch(async () => {
            return this.message.channel.send(normalized);
        });
        return this.replyMessage;
    }
    async editReply(options) {
        this.replied = true;
        const normalized = this.normalizeResponse(options);
        if (this.replyMessage) {
            await this.replyMessage.edit(normalized).catch(async () => {
                this.replyMessage = await this.message.reply(normalized).catch(() => null);
            });
        }
        else {
            this.replyMessage = await this.message.reply(normalized).catch(async () => {
                return this.message.channel.send(normalized);
            });
        }
        return this.replyMessage;
    }
    async followUp(options) {
        const normalized = this.normalizeResponse(options);
        return this.message.channel.send(normalized);
    }
    async fetchReply() {
        return this.replyMessage || this.message;
    }
    async showModal(modal) {
        const warning = {
            content: '⛔ **Discord API Error:** Modals can only be opened via Slash Commands or Button/Menu interactions. Please use the slash command equivalent instead.',
            ephemeral: true
        };
        if (this.replied || this.deferred) {
            await this.editReply(warning).catch(() => { });
        }
        else {
            await this.reply(warning).catch(() => { });
        }
    }
}
export function translateV2Components(options) {
    if (!options)
        return { content: ' ' };
    if (typeof options === 'string') {
        return { content: options };
    }
    const payload = { ...options };
    if (payload.components && Array.isArray(payload.components)) {
        const finalComponents = [];
        const finalEmbeds = payload.embeds || [];
        for (const comp of payload.components) {
            const isV2Container = comp && (comp.type === 17 ||
                (typeof comp.toJSON === 'function' && comp.toJSON().type === 17));
            if (isV2Container) {
                const data = typeof comp.toJSON === 'function' ? comp.toJSON() : comp;
                const embed = new EmbedBuilder()
                    .setColor(data.accent_color || 0x2b2d31);
                let description = '';
                const innerComponents = data.components || [];
                for (const inner of innerComponents) {
                    if (inner.type === 10) { // TextDisplay
                        description += (inner.content || '') + '\n';
                    }
                    else if (inner.type === 12) { // MediaGallery
                        if (inner.items && inner.items.length > 0) {
                            const firstItem = inner.items[0];
                            if (firstItem?.media?.url) {
                                embed.setImage(firstItem.media.url);
                            }
                        }
                    }
                    else if (inner.type === 14) { // Separator
                        description += '\n';
                    }
                    else if (inner.type === 9) { // Section
                        if (inner.components) {
                            for (const secComp of inner.components) {
                                if (secComp.type === 10) {
                                    description += (secComp.content || '') + '\n';
                                }
                            }
                        }
                        if (inner.accessory?.media?.url) {
                            embed.setThumbnail(inner.accessory.media.url);
                        }
                    }
                    else if (inner.type === 1) { // ActionRow (nested in V2 container)
                        finalComponents.push(inner);
                    }
                }
                if (description.trim()) {
                    embed.setDescription(description.trim().slice(0, 4096));
                }
                finalEmbeds.push(embed);
            }
            else {
                finalComponents.push(comp);
            }
        }
        payload.components = finalComponents;
        payload.embeds = finalEmbeds;
        if (payload.flags !== undefined) {
            payload.flags = payload.flags & ~32768; // Remove IS_COMPONENTS_V2 flag
        }
    }
    return payload;
}
