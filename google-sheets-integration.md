# Google Sheets & Forms Integration Guide
## Jesus Youth Campus Meet: Registration & Attendance System

This guide explains how to connect your **Google Form**, **Google Sheets**, and this **Web App**, as well as how to automatically generate and distribute QR codes for all participants.

---

## 1. How to Automatically Generate QR Codes in Google Sheets

You can generate QR codes directly in your Google Sheet without any add-ons or plugins using the `=IMAGE()` formula.

### Step-by-Step:
1. Open the Google Sheet linked to your Google Form.
2. In an empty column header (for example, Column `F`), type: **QR Code**.
3. In row 2 (`F2`), paste the following formula:
   ```excel
   =IMAGE("https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=" & ENCODEURL(A2))
   ```
   *(Replace `A2` with the cell containing the Participant's Registration ID, Email, or Full Name).*
4. Drag the fill handle down the column to generate QR codes for every student.

> [!TIP]
> Each student's QR code will display directly inside the spreadsheet cell!

---

## 2. Automatic Email with QR Code upon Google Form Submission

To automatically email each student their QR Code badge right after they fill the Google Form:

1. In your Google Sheet, go to **Extensions > Apps Script**.
2. Replace any existing code with the following:

```javascript
function onFormSubmit(e) {
  var responses = e.namedValues;
  var studentName = responses['Full Name'] ? responses['Full Name'][0] : 'Participant';
  var studentEmail = responses['Email Address'] ? responses['Email Address'][0] : responses['Email'][0];
  var college = responses['College'] ? responses['College'][0] : '';
  var parish = responses['Parish'] ? responses['Parish'][0] : '';
  
  // Create unique Registration ID (e.g. JY-101)
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var row = e.range.getRow();
  var regId = "JY-" + (row + 100);
  
  // Save Reg ID into Column A if not already present
  sheet.getRange(row, 1).setValue(regId);
  
  var qrCodeUrl = "https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=" + encodeURIComponent(regId);
  
  var emailBody = `
    <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; text-align: center;">
      <h2 style="color: #2563eb; margin-bottom: 4px;">Jesus Youth Campus Meet</h2>
      <p style="color: #64748b; font-size: 14px; margin-top: 0;">Registration Confirmation & Entry Pass</p>
      <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 15px 0;">
      <p style="font-size: 16px;">Dear <strong>${studentName}</strong>,</p>
      <p style="color: #334155; font-size: 14px;">Thank you for registering for the Campus Meet! Please present the QR code below at the registration counter upon arrival:</p>
      <div style="margin: 20px 0;">
        <img src="${qrCodeUrl}" alt="Registration QR Code" style="width: 180px; height: 180px; border: 1px solid #cbd5e1; padding: 6px; border-radius: 8px;">
      </div>
      <p style="font-family: monospace; font-size: 16px; font-weight: bold; color: #1e3a8a;">Reg ID: ${regId}</p>
      <p style="font-size: 13px; color: #64748b;">College: ${college} | Parish: ${parish}</p>
      <div style="background: #f1f5f9; padding: 10px; border-radius: 6px; font-size: 12px; color: #475569; margin-top: 15px;">
        Keep this email or save the QR code to your phone for quick check-in.
      </div>
    </div>
  `;
  
  if (studentEmail) {
    MailApp.sendEmail({
      to: studentEmail,
      subject: "Your Jesus Youth Campus Meet Entry Pass (QR Code)",
      htmlBody: emailBody
    });
  }
}
```

3. Click **Triggers** (the clock icon on the left menu).
4. Click **+ Add Trigger**:
   - Choose which function to run: `onFormSubmit`
   - Select event source: `From spreadsheet`
   - Select event type: `On form submit`
5. Click **Save** and grant permissions. Now every form submission will automatically receive their QR entry badge!

---

## 3. Real-Time Attendance Write-Back from Web App to Google Sheet

When volunteers scan a participant's QR code at the desk, this web app can instantly update the Google Sheet to mark them **Present** with the exact **Check-in Timestamp**.

### Setup:
1. In the Google Sheet, make sure you have columns for:
   - **Column A**: Registration ID (e.g. `JY-101`)
   - **Column G**: Attendance Status
   - **Column H**: Check-in Time
2. Open **Extensions > Apps Script** and paste:

```javascript
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    if (data.action === "markPresent") {
      var rows = sheet.getDataRange().getValues();
      var idCol = 0;     // Column A (Reg ID)
      var statusCol = 6; // Column G (Attendance)
      var timeCol = 7;   // Column H (Check-in Time)

      for (var i = 1; i < rows.length; i++) {
        if (rows[i][idCol].toString().trim() === data.id.toString().trim()) {
          sheet.getRange(i + 1, statusCol + 1).setValue("Present");
          sheet.getRange(i + 1, timeCol + 1).setValue(data.checkInTime || new Date().toLocaleTimeString());
          return ContentService.createTextOutput(JSON.stringify({status: "success"}))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }
    return ContentService.createTextOutput(JSON.stringify({status: "not_found"}))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({status: "error", error: err.message}))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. Click **Deploy > New deployment**.
4. Select type: **Web app**.
5. Set **Execute as**: *Me*.
6. Set **Who has access**: *Anyone*.
7. Copy the generated **Web App URL**.
8. In this web app, go to the **Google Sheets & Data** tab, paste the URL into **Google Apps Script Web App URL**, and click **Save URL**.

---

## 4. Offline / Batch Workflow (CSV)

If you do not want to set up an Apps Script:
1. In Google Sheets, click **File > Download > Comma Separated Values (.csv)**.
2. In this web app, open the **Google Sheets & Data** tab and click **Import CSV**.
3. Scan attendees during the meet.
4. At the end of the day, click **Export to CSV** in the **Participants** tab to download the updated attendance list with all check-in timestamps.
