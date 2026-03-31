import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import type { Env, FeedbackRow } from "../types";
import { insertFeedback, listProjects, updateFeedbackStatus, getFeedbackById } from "../db/queries";

interface UserSession {
  selectedProjectId?: string;
  awaitingDescription?: boolean;
}

const sessions = new Map<number, UserSession>();

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);

  // /start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "欢迎使用 DaBugs Bot! 🐛\n\n" +
      "可用命令:\n" +
      "/bug - 报告新 bug\n" +
      "/start - 显示此消息\n\n" +
      "你也可以直接发送文字或图片来报告 bug。"
    );
  });

  // /bug command - show project selection
  bot.command("bug", async (ctx) => {
    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("没有可用的项目。请先添加项目。");
      return;
    }

    if (projects.length === 1) {
      // Auto-select single project
      const userId = ctx.from?.id;
      if (userId) {
        sessions.set(userId, { selectedProjectId: projects[0].id, awaitingDescription: true });
      }
      await ctx.reply(`已选择项目: ${projects[0].name}\n\n请描述 bug 或发送截图:`);
      return;
    }

    // Multiple projects - show inline keyboard
    const keyboard = new InlineKeyboard();
    for (const project of projects) {
      keyboard.text(project.name, `select_project:${project.id}`).row();
    }

    await ctx.reply("请选择一个项目:", { reply_markup: keyboard });
  });

  // Callback query for project selection
  bot.callbackQuery(/^select_project:(.+)$/, async (ctx) => {
    const projectId = ctx.match[1];
    const userId = ctx.from.id;

    sessions.set(userId, { selectedProjectId: projectId, awaitingDescription: true });

    const projects = await listProjects(env.DB);
    const project = projects.find((p) => p.id === projectId);
    const projectName = project?.name ?? projectId;

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(`已选择项目: ${projectName}\n\n请描述 bug 或发送截图:`);
  });

  // Callback query for confirm diagnosis
  bot.callbackQuery(/^confirm:(\d+)$/, async (ctx) => {
    const feedbackId = parseInt(ctx.match[1], 10);

    try {
      await updateFeedbackStatus(env.DB, feedbackId, { status: "confirmed" });
      await ctx.answerCallbackQuery("已确认诊断");
      await ctx.editMessageReplyMarkup(); // Remove buttons
      await ctx.reply(`Bug #${feedbackId} 已确认，将开始修复。`);
    } catch (error) {
      await ctx.answerCallbackQuery("更新状态失败");
      console.error("Failed to confirm feedback:", error);
    }
  });

  // Callback query for reject diagnosis
  bot.callbackQuery(/^reject:(\d+)$/, async (ctx) => {
    const feedbackId = parseInt(ctx.match[1], 10);

    try {
      await updateFeedbackStatus(env.DB, feedbackId, { status: "rejected" });
      await ctx.answerCallbackQuery("已拒绝诊断");
      await ctx.editMessageReplyMarkup(); // Remove buttons
      await ctx.reply(`Bug #${feedbackId} 已拒绝，诊断需要修改。`);
    } catch (error) {
      await ctx.answerCallbackQuery("更新状态失败");
      console.error("Failed to reject feedback:", error);
    }
  });

  // Handle text messages
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id;
    const session = sessions.get(userId);
    const description = ctx.message.text;

    // Ignore commands
    if (description.startsWith("/")) return;

    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("没有可用的项目。请先添加项目。");
      return;
    }

    let projectId: string;
    let projectName: string;

    if (projects.length === 1) {
      // Auto-select single project
      projectId = projects[0].id;
      projectName = projects[0].name;
    } else if (session?.selectedProjectId && session.awaitingDescription) {
      // Use selected project
      projectId = session.selectedProjectId;
      const project = projects.find((p) => p.id === projectId);
      projectName = project?.name ?? projectId;

      // Clear session
      sessions.delete(userId);
    } else {
      // Multiple projects but no selection
      await ctx.reply("请先使用 /bug 选择项目");
      return;
    }

    try {
      const feedback = await insertFeedback(env.DB, {
        project_id: projectId,
        source: "telegram",
        description,
        reporter_id: userId.toString(),
        reporter_name: ctx.from.username ?? ctx.from.first_name ?? "Unknown",
      });

      await ctx.reply(`Bug 已记录! ID: #${feedback.id}\n项目: ${projectName}`);

      // Notify admin
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("记录 bug 失败，请稍后重试");
      console.error("Failed to insert feedback:", error);
    }
  });

  // Handle photo messages
  bot.on("message:photo", async (ctx) => {
    const userId = ctx.from.id;
    const session = sessions.get(userId);
    const description = ctx.message.caption ?? "screenshot";
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get largest photo
    const fileId = photo.file_id;

    const projects = await listProjects(env.DB);

    if (projects.length === 0) {
      await ctx.reply("没有可用的项目。请先添加项目。");
      return;
    }

    let projectId: string;
    let projectName: string;

    if (projects.length === 1) {
      // Auto-select single project
      projectId = projects[0].id;
      projectName = projects[0].name;
    } else if (session?.selectedProjectId && session.awaitingDescription) {
      // Use selected project
      projectId = session.selectedProjectId;
      const project = projects.find((p) => p.id === projectId);
      projectName = project?.name ?? projectId;

      // Clear session
      sessions.delete(userId);
    } else {
      // Multiple projects but no selection
      await ctx.reply("请先使用 /bug 选择项目");
      return;
    }

    try {
      const feedback = await insertFeedback(env.DB, {
        project_id: projectId,
        source: "telegram",
        description,
        reporter_id: userId.toString(),
        reporter_name: ctx.from.username ?? ctx.from.first_name ?? "Unknown",
        screenshot_urls: [fileId], // Store Telegram file_id
      });

      await ctx.reply(`Bug 已记录! ID: #${feedback.id}\n项目: ${projectName}`);

      // Notify admin
      await notifyAdmin(env, feedback, projectName);
    } catch (error) {
      await ctx.reply("记录 bug 失败，请稍后重试");
      console.error("Failed to insert feedback:", error);
    }
  });

  return bot;
}

export async function notifyAdmin(env: Env, feedback: FeedbackRow, projectName: string): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);

  const screenshots = feedback.screenshot_urls ? JSON.parse(feedback.screenshot_urls) : [];
  const screenshotInfo = screenshots.length > 0 ? `\n📷 截图: ${screenshots.length} 张` : "";

  const message =
    `🐛 新 Bug 报告 #${feedback.id}\n\n` +
    `项目: ${projectName}\n` +
    `描述: ${feedback.description}\n` +
    `报告人: ${feedback.reporter_name} (${feedback.reporter_id})` +
    screenshotInfo;

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
}

export async function sendDiagnosisNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);

  const message =
    `🔍 Bug 诊断完成 #${feedback.id}\n\n` +
    `项目: ${projectName}\n` +
    `描述: ${feedback.description}\n\n` +
    `诊断:\n${feedback.diagnosis}\n\n` +
    `修复计划:\n${feedback.fix_plan}`;

  const keyboard = new InlineKeyboard()
    .text("✅ 确认", `confirm:${feedback.id}`)
    .text("❌ 拒绝", `reject:${feedback.id}`);

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message, { reply_markup: keyboard });
}

export async function sendFixedNotification(
  env: Env,
  feedback: FeedbackRow,
  projectName: string
): Promise<void> {
  const bot = new Bot(env.BOT_TOKEN);

  // Notify admin
  const adminMessage =
    `✅ Bug 已修复 #${feedback.id}\n\n` +
    `项目: ${projectName}\n` +
    `PR: ${feedback.pr_url}`;

  await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, adminMessage);

  // Notify reporter if reporter_id exists
  if (feedback.reporter_id) {
    try {
      const reporterMessage =
        `✅ 你报告的 Bug #${feedback.id} 已修复!\n\n` +
        `项目: ${projectName}\n` +
        `描述: ${feedback.description}\n` +
        `PR: ${feedback.pr_url}`;

      await bot.api.sendMessage(feedback.reporter_id, reporterMessage);
    } catch (error) {
      // Ignore if can't send to reporter (e.g., user blocked bot)
      console.error("Failed to notify reporter:", error);
    }
  }
}

export function createWebhookHandler(env: Env) {
  const bot = createBot(env);
  return webhookCallback(bot, "cloudflare-mod");
}
