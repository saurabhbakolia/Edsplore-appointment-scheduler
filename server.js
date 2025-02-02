require("dotenv").config();
const express = require("express");
const moment = require("moment-timezone");
const { google } = require("googleapis");
const axios = require("axios");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Google Calendar API authentication
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
// oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
let calendar;

app.get('/', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope:'https://www.googleapis.com/auth/calendar'
  });
  res.redirect(url);
});

app.get('/redirect', (req, res) => {
  const code = req.query.code;
  oauth2Client.getToken(code, (err, token) => {
    if(err){
      console.error("Couldn't get token", err);
      res.send('Error: ' + err.message);
      return;
    }
    oauth2Client.setCredentials(token);
    calendar = google.calendar({ version: "v3", auth: oauth2Client });
    res.send("Successfully logged in.");
  });
});
app.post("/check_availability", async (req, res) => {
  try {
    const { timeZone, startDate, endDate } = req.body;

    // Convert dates to IST
    const startIST = moment.tz(startDate, "Asia/Kolkata").toISOString();
    const endIST = moment.tz(endDate, "Asia/Kolkata").toISOString();

    // Fetch free/busy slots from Google Calendar
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: startIST,
        timeMax: endIST,
        timeZone: timeZone,
        items: [{ id: "primary" }],
      },
    });

    const busySlots = data.calendars.primary.busy;

    // Generate available slots (Assume working hours 9 AM - 6 PM IST)
    let availableSlots = [];
    let currentTime = moment.tz(startIST, "Asia/Kolkata").hour(1).minute(0);

    while (currentTime.isBefore(moment.tz(endIST, "Asia/Kolkata").hour(18))) {
      let isBusy = busySlots.some(
        (slot) =>
          moment(slot.start).isSameOrBefore(currentTime) &&
          moment(slot.end).isAfter(currentTime)
      );

      if (!isBusy) {
        availableSlots.push(currentTime.clone());
      }

      currentTime.add(1, "hour");
    }

    // Convert available slots to user’s time zone
    let convertedSlots = availableSlots.map((slot) =>
      slot.clone().tz(timeZone).format("YYYY-MM-DD HH:mm:ss")
    );

    res.json({ timeZone: timeZone, availableSlots: convertedSlots });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching available slots" });
  }
});

// 2️⃣ Place the `save_booking` route here:
app.post("/save_booking", async (req, res) => {
  try {
    const { timeZone, selectedDateTime } = req.body;

    // Convert selected time to IST
    const selectedIST = moment.tz(selectedDateTime, timeZone).tz("Asia/Kolkata").toISOString();

    // Save booking to Google Calendar
    const event = {
      summary: "Appointment Scheduler Event!",
      start: { dateTime: selectedIST, timeZone: "Asia/Kolkata" },
      end: { dateTime: moment(selectedIST).add(1, "hour").toISOString(), timeZone: "Asia/Kolkata" },
    };

    await calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
    });

    res.json({ message: "Appointment booked successfully in IST", bookedTime: selectedIST });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error booking appointment" });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
