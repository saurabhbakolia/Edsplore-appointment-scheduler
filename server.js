require("dotenv").config();
const express = require("express");
const moment = require("moment-timezone");
const { google } = require("googleapis");
const path = require("path");
const { start } = require("repl");

// Load service account key file
const KEY_FILE_PATH = path.join(
  __dirname,
  "../google-calender-service-account.json"
);

// Authenticate with the service account
const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE_PATH,
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

// Get the Calendar API Client
const calendar = google.calendar({ version: "v3", auth });

// Google Calendar ID (Use the shared calendar's ID)
const calenderId = process.env.GOOGLE_CALENDAR_ID;

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
let preferredTimeZone = "Asia/Kolkata";

// app.get('/', (req, res) => {
//   const url = oauth2Client.generateAuthUrl({
//     access_type: 'offline',
//     scope:'https://www.googleapis.com/auth/calendar'
//   });
//   res.redirect(url);
// });

// app.get('/redirect', (req, res) => {
//   const code = req.query.code;
//   oauth2Client.getToken(code, (err, token) => {
//     if(err){
//       console.error("Couldn't get token", err);
//       res.send('Error: ' + err.message);
//       return;
//     }
//     console.log("token",token);
//     oauth2Client.setCredentials(token);
//     res.send("Successfully logged in.");
//   });
// });
app.post("/check_availability", async (req, res) => {
  try {
    let { args } = req.body;
    preferredTimeZone = args.timeZone;
    const timeZone = args.timeZone;
    const startDate = args.startDate;
    const endDate = args.endDate;
    console.log("req", startDate, endDate);
    // console.log("req.body", args);

    if (startDate && endDate) {
      const momentStartDate = moment.utc(startDate);
      const momentEndDate = moment.utc(endDate);
      if (!momentStartDate.isValid() || !momentEndDate.isValid()) {
        console.error("Invalid startDate or endDate");
        return res.status(400).json({
          status: "invalid",
          message: "Invalid startDate or endDate",
        });
      }
      if (momentStartDate.isAfter(momentEndDate)) {
        console.error("startDate cannot be after endDate");
        return res
          .status(400)
          .json({
            status: "invalid",
            message: "startDate cannot be after endDate",
          });
      }
    }

    // Default: Today as startDate, Two weeks later as endDate
    if (!startDate)
      startDate = moment().tz("Asia/Kolkata").startOf("day").toISOString();
    if (!endDate)
      endDate = moment(startDate)
        .tz("Asia/Kolkata")
        .add(14, "days")
        .endOf("day")
        .toISOString();

    const startIST = moment.tz(startDate, "Asia/Kolkata").toISOString();
    const endIST = moment.tz(endDate, "Asia/Kolkata").toISOString();

    // Fetch free/busy slots from Google Calendar
    const { data } = await calendar.freebusy.query({
      requestBody: {
        timeMin: startIST,
        timeMax: endIST,
        timeZone: timeZone || "Asia/Kolkata",
        items: [{ id: "primary" }],
      },
    });

    const busySlots = data.calendars.primary.busy;

    // Generate available slots (Assume working hours 9 AM - 6 PM IST)
    let availableSlots = [];
    let currentTime = moment.tz(startIST, "Asia/Kolkata").hour(9).minute(0);

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

    // Log available slots for debugging
    console.log("Available Slots:", availableSlots.length);
    console.log("Available Slot Sample", availableSlots[0]);

    // Convert available slots to user’s time zone
    let convertedSlots = availableSlots
      .map((slot) => {
        if (!moment.isMoment(slot)) {
          console.error("Invalid slot:", slot);
          return null;
        }
        return slot.clone().tz(timeZone).format("YYYY-MM-DD HH:mm:ss");
      })
      .filter((slot) => slot !== null);

    res.json({ timeZone: timeZone, availableSlots: convertedSlots });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error fetching available slots" });
  }
});

app.post("/save_booking", async (req, res) => {
  try {
    const { args } = req.body;
    const selectedDateTime = args.selectedDateTime;

    // Convert selected time to IST
    const selectedIST = moment
      .tz(selectedDateTime, preferredTimeZone)
      .tz("Asia/Kolkata")
      .toISOString();

    // Save booking to Google Calendar
    const event = {
      summary: "Appointment Scheduler Event!",
      start: { dateTime: selectedIST, timeZone: "Asia/Kolkata" },
      end: {
        dateTime: moment(selectedIST).add(1, "hour").toISOString(),
        timeZone: "Asia/Kolkata",
      },
      visibility: 'default', 
    };

    await calendar.events.insert({
      calendarId: "primary",
      requestBody: event,
    });
    
    console.log(event, "Appointment Scheduler Event");

    res.json({
      message: "Appointment booked successfully in IST",
      bookedTime: selectedIST,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error booking appointment" });
  }
});

app.get("/list_events", async (req, res) => {
  try {
    const response = await calendar.events.list({
      calendarId: "primary", // Use "primary" for the authenticated user's personal calendar
      timeMin: moment().toISOString(), // Only fetch future events
      maxResults: 10, // Limit the number of events returned
      singleEvents: true, // Ensure recurring events are returned as individual occurrences
      orderBy: "startTime", // Order by start time
    });

    // Convert event times to "Asia/Kolkata"
    const events = response.data.items.map(event => {
      const startTime = moment(event.start.dateTime).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
      const endTime = moment(event.end.dateTime).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');

      return {
        ...event,
        start: { ...event.start, dateTime: startTime },
        end: { ...event.end, dateTime: endTime },
      };
    });

    // Log events for debugging
    console.log("Fetched events:", events);

    if (events.length > 0) {
      res.json({ events });
    } else {
      res.json({ message: "No upcoming events found." });
    }
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Error fetching events" });
  }
});



app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
