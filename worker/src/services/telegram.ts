import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { Env, FeedbackRow } from "../types";
import {
  insertFeedback,
  listProjects,
  updateFeedbackStatus,
  getTelegramSession,
  setTelegramSession,
  deleteTelegramSession,
} from "../db/queries";

async function submitBug(
  env: Env,
  userId: number,
  userName: string,
  projectId: string,
  projectName: string,
  description: string,
  screenshotFileIds?: string[]
): Promise<FeedbackRow> {
  return insertFeedback(env.DB, {
    project_id: projectId,
    source: "telegram",
    description,
    reporter_id: userId.toString(),
    reporter_name: userName,
    screenshot_urls: screenshotFileIds,
  });
}

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // /start command
  bot.command("start", async (ctx) => {
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    if (isGroup) {
      await ctx.reply(
        "DaBugs Bot ready!\n\n" +
        "Report a bug:\n" +
        "/bug <description>\n\n" +
        "Example:\n" +
        "/bug Login button does nothing after clicking"
      );
    } else {
      await ctx.reply(
        "Welcome to DaBugs Bot!\n\n" +
        "Commands:\n" +
        "/bug <description> — Report a bug\n" +
        "/bug — Select project first (multi-project)\n\n" +
        "You can also send text or photos directly in private chat."
      );
    }
  });

  // /bug command
  bot.command("bug", async (ctx) => {
    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects available. Please add a project first.");
      return;
    }

    const userId = ctx.from?.id;
    const userName = ctx.from?.username ?? ctx.from?.first_name ?? "Unknown";
    const text = ctx.match?.trim() ?? "";
    const isGroup = ctx.chat.type === "group" || ctx.chat.type === "supergroup";

    // Single project — auto-select
    if (projects.length === 1) {
      if (text) {
        // /bug Login button broken → submit directly
        try {
          const feedback = await submitBug(env, userId!, userName, projects[0].id, projects[0].name, text);
          await ctx.reply(`✅ Bug #${feedback.id} recorded! [${projects[0].name}]`);
          await notifyAdmin(env, feedback, projects[0].name);
        } catch (error) {
          await ctx.reply("Failed to record bug. Please try again.");
          console.error("Failed to insert feedback:", error);
        }
      } else if (isGroup) {
        await ctx.reply("Usage: /bug <description>\n\nExample: /bug Login button does nothing");
      } else {
        // Private chat, no description — ask for it
        if (userId) {
          await setTelegramSession(env.DB, userId, projects[0].id);
        }
        await ctx.reply(`Project: ${projects[0].name}\n\nDescribe the bug or send a screenshot:`);
      }
      return;
    }

    // Multiple projects
    if (text) {
      // /bug Login button broken → need project selection, store description in session
      // Encode description in callback data is too long, so store in session and show keyboard
      if (userId) {
        await setTelegramSession(env.DB, userId, `pending_desc:${text}`);
      }
      const keyboard = new InlineKeyboard();
      for (const project of projects) {
        keyboard.text(project.name, `select_project:${project.id}`).row();
      }
      await ctx.reply("Select a project for this bug:", { reply_markup: keyboard });
    } else if (isGroup) {
      await ctx.reply("Usage: /bug <description>\n\nExample: /bug Login button does nothing");
    } else {
      // Private chat — show project selection
      const keyboard = new InlineKeyboard();
      for (const project of projects) {
        keyboard.text(project.name, `select_project:${project.id}`).row();
      }
      await ctx.reply("Select a project:", { reply_markup: keyboard });
    }
  });

  // Callback query for project selection
  bot.callbackQuery(/^select_project:(.+)$/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;
    const userName = ctx.from.username ?? ctx.from.first_name ?? "Unknown";

    const projects = await listProjects(env.DB);
    const project = projects.find((p) => p.id === projectId);
    const projectName = project?.name ?? projectId;

    // Check if there's a pending description in session
    const session = await getTelegramSession(env.DB, userId);

    if (session?.startsWith("pending_desc:")) {
      // User already provided description via /bug <desc>, just needed project
      const description = session.replace("pending_desc:", "");
      await deleteTelegramSession(env.DB, userId);
      await ctx.answerCallbackQuery();

      try {
        const feedback = await submitBug(env, userId, userName, projectId, projectName, description);
        await ctx.editMessageText(`✅ Bug #${feedback.id} recorded! [${projectName}]\n\n${description}`);
        await notifyAdmin(env, feedback, projectName);
      } catch (error) {
        await ctx.editMessageText("Failed to record bug. Please try again.");
        console.error("Failed to insert feedback:", error);
      }
    } else {
      // No description yet — save project, ask for description (private chat flow)
      await setTelegramSession(env.DB, userId, projectId);
      await ctx.answerCallbackQuery();
      await ctx.editMessageText(`Selected: ${projectName}\n\nDescribe the bug or send a screenshot:`);
    }
  });

  // Callback query for confirm diagnosis
  bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
    const feedbackId = parseInt(ctx.match[1], 10);

    try {
      await updateFeedbackStatus(env.DB, feedbackId, { status: "confirmed" });
      await ctx.answerCallbackQuery("Diagnosis confirmed");
      await ctx.editMessageReplyMarkup();
      await ctx.reply(`✅ Bug #${feedbackId} confirmed. Fix will begin shortly.`);
    } catch (error) {
      await ctx.answerCallbackQuery("Failed to update status");
      console.error("Failed to confirm feedback:", error);
    }
  });

  // Callback query for reject diagnosis
  bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
    const feedbackId = parseInt(ctx.match[1], 10);

    try {
      await updateFeedbackStatus(env.DB, feedbackId, { status: "rejected" });
      await ctx.answerCallbackQuery("Diagnosis rejected");
      await ctx.editMessageReplyMarkup();
      await ctx.reply(`Bug #${feedbackId} rejected.`);
    } catch (error) {
      await ctx.answerCallbackQuery("Failed to update status");
      console.error("Failed to reject feedback:", error);
    }
  });

  // Handle text messages (private chat only — groups can't receive these without privacy mode off)
  bot.on("message:text", async (ctx) => {
    // Ignore groups — use /bug command instead
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") return;

    const userId = ctx.from.id;
    const userName = ctx.from.username ?? ctx.from.first_name ?? "Unknown";
    const description = ctx.message.text;

    if (description.startsWith("/")) return;

    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects available. Please add a project first.");
      return;
    }

    let projectId: string;
    let projectName: string;

    if (projects.length === 1) {
      projectId = projects[0].id;
      projectName = projects[0].name;
    } else {
      const sessionProjectId = await getTelegramSession(env.DB, userId);
      if (sessionProjectId && !sessionProjectId.startsWith("pending_desc:")) {
        projectId = sessionProjectId;
        const project = projects.find((p) => p.id === projectId);
        projectName = project?.name ?? projectId;
        await deleteTelegramSession(env.DB, userId);
      } else {
        await ctx.reply("Please use /bug to select a project first.");
        return;
      }
    }

    try {
      const feedback = await submitBug(env, userId, userName, projectId, projectName, description);
      await ctx.reply(`✅ Bug #${feedback.id} recorded! [${projectName}]`);
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("Failed to record bug. Please try again.");
      console.error("Failed to insert feedback:", error);
    }
  });

  // Handle photo messages (private chat only)
  bot.on("message:photo", async (ctx) => {
    if (ctx.chat.type === "group" || ctx.chat.type === "supergroup") return;

    const userId = ctx.from.id;
    const userName = ctx.from.username ?? ctx.from.first_name ?? "Unknown";
    const description = ctx.message.caption ?? "screenshot";
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileId = photo.file_id;

    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects available. Please add a project first.");
      return;
    }

    let projectId: string;
    let projectName: string;

    if (projects.length === 1) {
      projectId = projects[0].id;
      projectName = projects[0].name;
    } else {
      const sessionProjectId = await getTelegramSession(env.DB, userId);
      if (sessionProjectId && !sessionProjectId.startsWith("pending_desc:")) {
        projectId = sessionProjectId;
        const project = projects.find((p) => p.id === projectId);
        projectName = project?.name ?? projectId;
        await deleteTelegramSession(env.DB, userId);
      } else {
        await ctx.reply("Please use /bug to select a project first.");
        return;
      }
    }

    try {
      const feedback = await submitBug(env, userId, userName, projectId, projectName, description, [fileId]);
      await ctx.reply(`✅ Bug #${feedback.id} recorded! [${projectName}]`);
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("Failed to record bug. Please try again.");
      console.error("Failed to insert feedback:", error);
    }
  });

  return bot;
}

export async function notifyAdmin(env: Env, feedback: FeedbackRow, projectName: string): Promise<void> {
  if (!env.TELEGRAM_ADMIN_CHAT_ID) return;

  const bot = new Bot(env.BOT_TOKEN);

  const screenshots = feedback.screenshot_urls ? JSON.parse(feedback.screenshot_urls) : [];
  const screenshotInfo = screenshots.length > 0 ? `\nScreenshots: ${screenshots.length}` : "";

  const message =
    `🐛 New Bug #${feedback.id}\n\n` +
    `Project: ${projectName}\n` +
    `Description: ${feedback.description}\n` +
    `Reporter: ${feedback.reporter_name}` +
    screenshotInfo;

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
}

export async function sendDiagnosisNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  if (!env.TELEGRAM_ADMIN_CHAT_ID) return;

  const bot = new Bot(env.BOT_TOKEN);

  const message =
    `🔍 Bug #${feedback.id} Diagnosis [${projectName}]\n\n` +
    `Description: ${feedback.description}\n\n` +
    `Diagnosis:\n${feedback.diagnosis}\n\n` +
    `Fix Plan:\n${feedback.fix_plan}`;

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm Fix", `confirm:${feedback.id}`)
    .text("❌ Reject", `reject:${feedback.id}`);

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message, { reply_markup: keyboard });
}

export async function sendFixedNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  if (!env.TELEGRAM_ADMIN_CHAT_ID) return;

  const bot = new Bot(env.BOT_TOKEN);

  const adminMessage =
    `✅ Bug #${feedback.id} Fixed!\n\n` +
    `Project: ${projectName}\n` +
    `PR: ${feedback.pr_url}`;

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, adminMessage);

  if (feedback.reporter_id) {
    try {
      const reporterMessage =
        `🎉 Your bug #${feedback.id} has been fixed!\n\n` +
        `Project: ${projectName}\n` +
        `PR: ${feedback.pr_url}`;

      await bot.api.sendMessage(feedback.reporter_id, reporterMessage);
    } catch (error) {
      console.error("Failed to notify reporter:", error);
    }
  }
}

export function createWebhookHandler(env: Env) {
  const bot = createBot(env);
  return webhookCallback(bot, "cloudflare-mod");
}
