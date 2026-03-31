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

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "Welcome to DaBugs Bot!\n\n" +
      "Commands:\n" +
      "/bug - Report a new bug\n" +
      "/start - Show this message\n\n" +
      "You can also send text or photos directly to report a bug."
    );
  });

  // /bug command - show project selection
  bot.command("bug", async (ctx) => {
    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("No projects available. Please add a project first.");
      return;
    }

    if (projects.length === 1) {
      const userId = ctx.from?.id;
      if (userId) {
        await setTelegramSession(env.DB, userId, projects[0].id);
      }
      await ctx.reply(`Selected project: ${projects[0].name}\n\nDescribe the bug or send a screenshot:`);
      return;
    }

    const keyboard = new InlineKeyboard();
    for (const project of projects) {
      keyboard.text(project.name, `select_project:${project.id}`).row();
    }

    await ctx.reply("Select a project:", { reply_markup: keyboard });
  });

  // Callback query for project selection
  bot.callbackQuery(/^select_project:(.+)$/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;

    await setTelegramSession(env.DB, userId, projectId);

    const projects = await listProjects(env.DB);
    const project = projects.find((p) => p.id === projectId);
    const projectName = project?.name ?? projectId;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`Selected project: ${projectName}\n\nDescribe the bug or send a screenshot:`);
  });

  // Callback query for confirm diagnosis
  bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
    const feedbackId = parseInt(ctx.match[1], 10);

    try {
      await updateFeedbackStatus(env.DB, feedbackId, { status: "confirmed" });
      await ctx.answerCallbackQuery("Diagnosis confirmed");
      await ctx.editMessageReplyMarkup();
      await ctx.reply(`Bug #${feedbackId} confirmed. Fix will begin shortly.`);
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

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
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
      if (sessionProjectId) {
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
      const feedback = await insertFeedback(env.DB, {
        project_id: projectId,
        source: "telegram",
        description,
        reporter_id: userId.toString(),
        reporter_name: ctx.from.username ?? ctx.from.first_name ?? "Unknown",
      });

      await ctx.reply(`Bug recorded! ID: #${feedback.id}\nProject: ${projectName}`);
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("Failed to record bug. Please try again later.");
      console.error("Failed to insert feedback:", error);
    }
  });

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    const userId = ctx.from.id;
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
      if (sessionProjectId) {
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
      const feedback = await insertFeedback(env.DB, {
        project_id: projectId,
        source: "telegram",
        description,
        reporter_id: userId.toString(),
        reporter_name: ctx.from.username ?? ctx.from.first_name ?? "Unknown",
        screenshot_urls: [fileId],
      });

      await ctx.reply(`Bug recorded! ID: #${feedback.id}\nProject: ${projectName}`);
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("Failed to record bug. Please try again later.");
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
    `New Bug Report #${feedback.id}\n\n` +
    `Project: ${projectName}\n` +
    `Description: ${feedback.description}\n` +
    `Reporter: ${feedback.reporter_name} (${feedback.reporter_id})` +
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
    `Bug #${feedback.id} Diagnosis [${projectName}]\n\n` +
    `Description: ${feedback.description}\n\n` +
    `Diagnosis:\n${feedback.diagnosis}\n\n` +
    `Fix Plan:\n${feedback.fix_plan}`;

  const keyboard = new InlineKeyboard()
    .text("Confirm Fix", `confirm:${feedback.id}`)
    .text("Reject", `reject:${feedback.id}`);

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
    `Bug #${feedback.id} Fixed!\n\n` +
    `Project: ${projectName}\n` +
    `PR: ${feedback.pr_url}`;

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, adminMessage);

  if (feedback.reporter_id) {
    try {
      const reporterMessage =
        `Your bug #${feedback.id} has been fixed!\n\n` +
        `Project: ${projectName}\n` +
        `Description: ${feedback.description}\n` +
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
