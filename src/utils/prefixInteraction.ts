import { 
    Client, Message, User, GuildMember, Guild, TextBasedChannel, 
    AttachmentBuilder
} from 'discord.js';

export class PrefixInteraction {
    public id: string;
    public client: Client;
    public message: Message;
    public user: User;
    public member: GuildMember | null;
    public guild: Guild | null;
    public guildId: string | null;
    public channel: TextBasedChannel | null;
    public channelId: string;
    public options: any;
    public commandName: string;
    public deferred = false;
    public replied = false;
    private replyMessage: Message | null = null;

    constructor(message: Message, commandName: string, args: string[], commandData: any) {
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

    private buildOptionsResolver(args: string[], commandData: any) {
        const optionsMap = new Map<string, any>();
        let subcommand: string | null = null;
        let subcommandGroup: string | null = null;

        const optionsList = commandData.options || [];
        const hasSubcommands = optionsList.some((opt: any) => opt.type === 1 || opt.type === 2);

        let remainingArgs = [...args];

        if (hasSubcommands && remainingArgs.length > 0) {
            const possibleSub = remainingArgs[0].toLowerCase();
            const subOpt = optionsList.find((opt: any) => opt.name.toLowerCase() === possibleSub);
            if (subOpt) {
                if (subOpt.type === 1) { // SUB_COMMAND
                    subcommand = subOpt.name;
                    remainingArgs.shift();
                    const subOptions = subOpt.options || [];
                    this.mapArgsToOptions(remainingArgs, subOptions, optionsMap);
                } else if (subOpt.type === 2) { // SUB_COMMAND_GROUP
                    subcommandGroup = subOpt.name;
                    remainingArgs.shift();
                    if (remainingArgs.length > 0) {
                        const possibleSub2 = remainingArgs[0].toLowerCase();
                        const subOpt2 = subOpt.options?.find((opt: any) => opt.name.toLowerCase() === possibleSub2);
                        if (subOpt2 && subOpt2.type === 1) {
                            subcommand = subOpt2.name;
                            remainingArgs.shift();
                            const subOptions = subOpt2.options || [];
                            this.mapArgsToOptions(remainingArgs, subOptions, optionsMap);
                        }
                    }
                }
            }
        } else {
            this.mapArgsToOptions(remainingArgs, optionsList, optionsMap);
        }

        return {
            getString: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined && required) throw new Error(`Missing option ${name}`);
                return val !== undefined ? String(val) : null;
            },
            getBoolean: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined) return null;
                return val === true || String(val).toLowerCase() === 'true' || String(val) === '1' || String(val).toLowerCase() === 'yes';
            },
            getInteger: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined) return null;
                const parsed = parseInt(String(val), 10);
                return isNaN(parsed) ? null : parsed;
            },
            getNumber: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined) return null;
                const parsed = parseFloat(String(val));
                return isNaN(parsed) ? null : parsed;
            },
            getUser: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined && required) throw new Error(`Missing option ${name}`);
                if (!val) return null;
                const id = val.replace(/[<@!>]/g, '');
                const resolved = this.client.users.cache.get(id) || this.message.mentions.users.get(id) || null;
                if (resolved === null && required) throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getRole: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined && required) throw new Error(`Missing option ${name}`);
                if (!val || !this.guild) return null;
                const id = val.replace(/[<@&>]/g, '');
                const resolved = this.guild.roles.cache.get(id) || this.message.mentions.roles.get(id) || null;
                if (resolved === null && required) throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getChannel: (name: string, required?: boolean) => {
                const val = optionsMap.get(name);
                if (val === undefined && required) throw new Error(`Missing option ${name}`);
                if (!val || !this.guild) return null;
                const id = val.replace(/[<#>]/g, '');
                const resolved = this.guild.channels.cache.get(id) || this.message.mentions.channels.get(id) || null;
                if (resolved === null && required) throw new Error(`Missing option ${name}`);
                return resolved;
            },
            getSubcommand: (required?: boolean) => subcommand,
            getSubcommandGroup: (required?: boolean) => subcommandGroup,
        };
    }

    private mapArgsToOptions(args: string[], optionsSchema: any[], optionsMap: Map<string, any>) {
        optionsSchema.forEach((opt: any, index: number) => {
            if (args[index] !== undefined) {
                optionsMap.set(opt.name, args[index]);
            }
        });
    }

    private normalizeResponse(options: any) {
        if (!options) return { content: ' ' };
        if (typeof options === 'string') {
            return { content: options };
        }
        return { ...options };
    }

    async deferReply(options?: { flags?: number }) {
        if (this.deferred || this.replied) return;
        this.deferred = true;
        this.replyMessage = await this.message.reply({ content: '⏳ Processing...' }).catch(async () => {
            return (this.message.channel as any).send({ content: '⏳ Processing...' });
        });
    }

    async reply(options: any) {
        if (this.replied || this.deferred) {
            return this.editReply(options);
        }
        this.replied = true;
        const normalized = this.normalizeResponse(options);
        this.replyMessage = await this.message.reply(normalized).catch(async () => {
            return (this.message.channel as any).send(normalized);
        });
        return this.replyMessage;
    }

    async editReply(options: any) {
        this.replied = true;
        const normalized = this.normalizeResponse(options);
        if (this.replyMessage) {
            await this.replyMessage.edit(normalized).catch(async () => {
                this.replyMessage = await this.message.reply(normalized).catch(() => null);
            });
        } else {
            this.replyMessage = await this.message.reply(normalized).catch(async () => {
                return (this.message.channel as any).send(normalized);
            });
        }
        return this.replyMessage;
    }

    async followUp(options: any) {
        const normalized = this.normalizeResponse(options);
        return (this.message.channel as any).send(normalized);
    }

    async fetchReply() {
        return this.replyMessage || this.message;
    }

    async showModal(modal: any) {
        const warning = {
            content: '⛔ **Discord API Error:** Modals can only be opened via Slash Commands or Button/Menu interactions. Please use the slash command equivalent instead.',
            ephemeral: true
        };
        if (this.replied || this.deferred) {
            await this.editReply(warning).catch(() => {});
        } else {
            await this.reply(warning).catch(() => {});
        }
    }
}
