import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, } from 'discord.js';
import { extraOwnerSettings } from '../services/extraOwnerSettings.js';
import { canManageSecurity } from '../utils/securityAuth.js';
import { ComponentsV2 } from '../embeds/componentsV2.js';
export const extraOwnerCommand = {
    data: new SlashCommandBuilder()
        .setName('extraowner')
        .setDescription('Manage Extra Owners who can use Anti-Nuke and Whitelist security (Grav only)')
        .setDMPermission(false)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((sub) => sub
        .setName('add')
        .setDescription('Add a user or role as an Extra Owner (Grav only)')
        .addUserOption((opt) => opt.setName('user').setDescription('User to designate as Extra Owner').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to designate as Extra Owner (all members gain access)').setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('remove')
        .setDescription('Remove an Extra Owner user or role (Grav only)')
        .addUserOption((opt) => opt.setName('user').setDescription('User to remove from Extra Owners').setRequired(false))
        .addRoleOption((opt) => opt.setName('role').setDescription('Role to remove from Extra Owners').setRequired(false)))
        .addSubcommand((sub) => sub
        .setName('list')
        .setDescription('View all designated Extra Owner users and roles')),
    cooldown: 3,
    async execute(interaction) {
        if (!interaction.guild) {
            await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
            return;
        }
        const sub = interaction.options.getSubcommand();
        const member = interaction.guild.members.cache.get(interaction.user.id) || null;
        const auth = await canManageSecurity(interaction.user, interaction.client, interaction.guild, member);
        if (!auth.authorized) {
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            c.addTextDisplayComponents(ComponentsV2.text(`# 🚫 Access Denied\n` +
                `You do not have permission to use this command.\n\n` +
                `> **Restriction:** Only **Grav** (Primary Owner) or designated **Extra Owners** can view or configure security.\n` +
                `-# Victus Cloud Defense Protocol`));
            await interaction.reply({ components: [c], flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        // Modifications (add / remove) strictly require Grav
        if ((sub === 'add' || sub === 'remove') && !auth.isGrav) {
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.danger);
            c.addTextDisplayComponents(ComponentsV2.text(`# 🔒 Grav Authorization Required\n` +
                `Only **Grav** (Primary Bot / Server Owner) has permission to add or remove Extra Owners.\n\n` +
                `> **Your Status:** Extra Owner (Config access granted, Extra Owner delegation restricted).\n` +
                `-# Contact Grav if you need to grant extra owner privileges to someone.`));
            await interaction.reply({ components: [c], flags: MessageFlags.Ephemeral | ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        const guildId = interaction.guild.id;
        if (sub === 'add') {
            const targetUser = interaction.options.getUser('user');
            const targetRole = interaction.options.getRole('role');
            if (!targetUser && !targetRole) {
                await interaction.reply({
                    content: '❌ Please specify either a **user** or a **role** to add as an Extra Owner.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const results = [];
            if (targetUser) {
                await extraOwnerSettings.addUser(guildId, {
                    userId: targetUser.id,
                    username: targetUser.username,
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                });
                results.push(`👤 User <@${targetUser.id}> (\`${targetUser.username}\`) has been designated as an **Extra Owner**!`);
            }
            if (targetRole) {
                await extraOwnerSettings.addRole(guildId, {
                    roleId: targetRole.id,
                    roleName: targetRole.name,
                    addedBy: interaction.user.id,
                    addedAt: new Date().toISOString(),
                });
                results.push(`🎭 Role <@&${targetRole.id}> (\`${targetRole.name}\`) has been designated as an **Extra Owner Role**!\n   *(All members with this role now have Extra Owner privileges)*`);
            }
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.success);
            c.addTextDisplayComponents(ComponentsV2.text(`# 👑 Extra Owner Added\n\n` +
                results.join('\n\n') +
                `\n\n> **Permissions Granted:** Can use \`/antinuke\` and \`/whitelist\` commands and bypass Anti-Nuke restrictions.\n` +
                `-# Authorized by Grav (<@${interaction.user.id}>)`));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        if (sub === 'remove') {
            const targetUser = interaction.options.getUser('user');
            const targetRole = interaction.options.getRole('role');
            if (!targetUser && !targetRole) {
                await interaction.reply({
                    content: '❌ Please specify either a **user** or a **role** to remove from Extra Owners.',
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }
            const results = [];
            if (targetUser) {
                const res = await extraOwnerSettings.removeUser(guildId, targetUser.id);
                if (res.success) {
                    results.push(`👤 User <@${targetUser.id}> (\`${targetUser.username}\`) has been removed from Extra Owners.`);
                }
                else {
                    results.push(`⚠️ User <@${targetUser.id}> was not in the Extra Owners list.`);
                }
            }
            if (targetRole) {
                const res = await extraOwnerSettings.removeRole(guildId, targetRole.id);
                if (res.success) {
                    results.push(`🎭 Role <@&${targetRole.id}> (\`${targetRole.name}\`) has been removed from Extra Owners.`);
                }
                else {
                    results.push(`⚠️ Role <@&${targetRole.id}> was not in the Extra Owners list.`);
                }
            }
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.warning);
            c.addTextDisplayComponents(ComponentsV2.text(`# 🗑️ Extra Owner Removed\n\n` +
                results.join('\n\n') +
                `\n\n-# Updated by Grav (<@${interaction.user.id}>)`));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
            return;
        }
        if (sub === 'list') {
            const config = await extraOwnerSettings.get(guildId);
            const userList = config.users.length > 0
                ? config.users.map((u, i) => `› **${i + 1}.** <@${u.userId}> (\`${u.username}\` · \`${u.userId}\`)`).join('\n')
                : '› *No individual users added.*';
            const roleList = config.roles.length > 0
                ? config.roles.map((r, i) => `› **${i + 1}.** <@&${r.roleId}> (\`${r.roleName}\` · \`${r.roleId}\`) — *All role holders*`).join('\n')
                : '› *No roles designated.*';
            const c = ComponentsV2.baseContainer(ComponentsV2.Accents.primary);
            c.addTextDisplayComponents(ComponentsV2.text(`# 👑 Extra Owners: ${interaction.guild.name}\n\n` +
                `Designated individuals and roles with authorization to manage \`/antinuke\` & \`/whitelist\`.\n\n` +
                `### 👤 Extra Owner Users:\n` +
                `${userList}\n\n` +
                `### 🎭 Extra Owner Roles:\n` +
                `${roleList}\n\n` +
                `> **Primary Owner (Grav):** <@${interaction.guild.ownerId}>\n` +
                `-# Only Grav can add or remove Extra Owners.`));
            await interaction.reply({ components: [c], flags: ComponentsV2.IS_COMPONENTS_V2 });
        }
    },
};
