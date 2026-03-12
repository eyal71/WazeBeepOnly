# WazeBeepOnly

## מטרת הפרויקט
חבילת קול מותאמת אישית ל-Waze (Android) ללא הנחיות קוליות - רק צלילי beep.
בהשראת: https://waze.uservoice.com/forums/59223-waze-suggestion-box/suggestions/4300357-add-beep-only-option-to-the-sound-options

## ארכיטקטורה
Web App (HTML/JS) שמאפשר בחירה per-event → מוריד ZIP עם קבצי .mp3 מוכנים.

## Waze Voice Pack - מפרט טכני
- פלטפורמה: Android בלבד
- 58 קבצי .mp3
- פורמט אודיו: AAC LC, 12kb/s, 8000 Hz, mono
- גודל מקסימלי: 0.8MB סה"כ
- מיקום ב-Android: `/storage/emulated/0/waze/sound/[folder-name]/`

## 3 סוגי צלילים
1. **שקט** - קובץ .mp3 ריק (silence)
2. **beep בודד** - צליל קצר חד
3. **beep כפול** - שני צלילים קצרים

## רשימת כל הקבצים (58)

### פניות
TurnLeft, TurnRight, KeepLeft, KeepRight, Straight, ExitLeft, ExitRight, Exit, uturn, Roundabout

### מספרים (יציאות בכיכר)
First, Second, Third, Fourth, Fifth, Sixth, Seventh, AndThen

### מרחקים
200, 400, 800, 1500, 200meters, 400meters, 800meters, 1000meters, 1500meters, ft, m, within

### התחלה/סיום
StartDrive1–StartDrive9, Arrive

### התרעות
ApproachAccident, ApproachHazard, ApproachRedLightCam, ApproachSpeedCam, ApproachTraffic, Police

### צלילי UI
click, click_long, ping, ping2, TickerPoints, message_ticker, alert_1, bonus, reminder, rec_start, rec_end

## סטטוס
ממתין לאישור הגדרות ברירת מחדל מהמשתמש.
