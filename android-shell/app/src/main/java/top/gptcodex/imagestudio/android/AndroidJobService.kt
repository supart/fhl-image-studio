package top.fangtangyuan.fhlstudio.android

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class AndroidJobService : Service() {
    companion object {
        const val ACTION_RUN_JOBS = "top.fangtangyuan.fhlstudio.android.action.RUN_JOBS"
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startInForeground()
        AndroidJobManager.ensureWorker(applicationContext) {
            stopSelfResult(startId)
        }
        return START_STICKY
    }

    private fun startInForeground() {
        val notification = AndroidJobNotifications.foregroundNotification(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                AndroidJobNotifications.foregroundNotificationId,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
            )
        } else {
            startForeground(AndroidJobNotifications.foregroundNotificationId, notification)
        }
    }
}
