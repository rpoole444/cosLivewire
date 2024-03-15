require('dotenv').config();
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const initializePassport = require('./passport-config')
const { createUser, findUserByEmail, findUserById } = require('./models/User');
const { createEvent, getEventsForReview, updateEventStatus } = require('./models/Event');
// const flash = require('connect-flash');
const authRouter = express.Router();
const eventRouter = express.Router();
const app = express();

// app.use(flash());
app.use(express.urlencoded({ extended:false }));
app.use(express.json());
//router setup
app.use('/api/events', eventRouter);
app.use('/api/auth', authRouter)
//session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave:false,
  saveUninitialized:true
}));
//passport middleware
app.use(passport.initialize());
app.use(passport.session());



initializePassport(passport, findUserByEmail, findUserById);


// Registration endpoint
authRouter.post('/register', async (req, res) => {
  try{
    const { email, password } = req.body;
    if(!email || !password){
      return res.status(400).json({error: 'Please provide an email and password'});
    }

    const existingUser = await findUserByEmail(email);
    if(existingUser){
      return res.status(400).json({error: 'User already exists'});
    }
    await createUser(email,password);
    res.status(201).json({message: 'User created successfully'})
  } catch (err) {
    res.status(500).json({message: 'Internal Server Error'});
  }
});


authRouter.post('/login', passport.authenticate('local', {
  successRedirect: '/',
  failureRedirect: '/login',
  // failureFlash: true
}))

//EVENT Endpoints
eventRouter.post('/submit', async (req, res) => {
  try {
    const eventData = req.body; // Include user_id, title, description, location, date, etc.
    const event = await createEvent(eventData);
    res.status(201).json({ event: event[0], message: 'Event submitted successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});
// Fetch events pending review
eventRouter.get('/review', async (req, res) => {
  try {
    const events = await getEventsForReview();
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// Update event status (approve/deny)
eventRouter.put('/review/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { isApproved } = req.body; // Expecting a boolean value
    const updatedEvent = await updateEventStatus(eventId, isApproved);
    res.json({ event: updatedEvent[0], message: 'Event status updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});


app.get('/', (req, res) => res.send('Hello World!'));
// Error handling middleware should be the last piece of middleware added to the app
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

