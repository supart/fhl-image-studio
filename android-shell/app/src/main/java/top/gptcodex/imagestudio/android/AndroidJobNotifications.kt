package top.fangtangyuan.fhlstudio.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat

object AndroidJobNotifications {
    const val channelId = "fhl_studio_generation"
    const val foregroundNotificationId = 207550870
    private const val completionNotificationBaseId = 207550900

    fun foregroundNotification(context: Context): Notification {
        ensureChannel(context)
        return NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("FHL Studio 正在生成图片")
            .setContentText("退到桌面后任务仍会继续，完成后点通知或重新打开 App 查看结果。")
            .setContentIntent(openAppIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    fun notifySuccess(
        context: Context,
        jobId: String,
        prompt: String,
        savedPath: String,
        galleryUri: String?,
    ) {
        val text = if (!galleryUri.isNullOrBlank()) {
            "已保存到相册 Pictures/ImageStudio，点此回到结果。"
        } else {
            "已保存到 App 结果记录，点此回到结果。"
        }
        val detail = listOf(
            prompt.trim().take(80).ifBlank { "图片生成完成" },
            savedPath.substringAfterLast('/').substringAfterLast('\\'),
        ).filter { it.isNotBlank() }.joinToString("\n")
        notify(
            context,
            jobId,
            "图片已生成",
            text,
            detail,
            android.R.drawable.stat_sys_download_done,
        )
    }

    fun notifyFailure(context: Context, jobId: String, message: String) {
        notify(
            context,
            jobId,
            "图片生成失败",
            message.ifBlank { "请回到 App 查看错误详情。" }.take(160),
            message.ifBlank { "请回到 App 查看错误详情。" }.take(240),
            android.R.drawable.stat_notify_error,
        )
    }

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            channelId,
            "FHL Studio 生图任务",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "FHL Studio 后台生图任务进度和完成通知"
        }
        manager.createNotificationChannel(channel)
    }

    private fun notify(
        context: Context,
        jobId: String,
        title: String,
        text: String,
        detail: String,
        icon: Int,
    ) {
        try {
            ensureChannel(context)
            val notification = NotificationCompat.Builder(context, channelId)
                .setSmallIcon(icon)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(detail.ifBlank { text }))
                .setContentIntent(openAppIntent(context))
                .setAutoCancel(true)
                .setOnlyAlertOnce(false)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(notificationIdFor(jobId), notification)
        } catch (_: Exception) {
            // Notifications are best-effort; the image is already saved in the job registry/gallery path.
        }
    }

    private fun openAppIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra("openAndroidJobs", true)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        return PendingIntent.getActivity(context, 0, intent, flags)
    }

    private fun notificationIdFor(jobId: String): Int {
        return completionNotificationBaseId + (jobId.hashCode() and 0x3fff)
    }
}
