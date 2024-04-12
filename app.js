require('dotenv').config(); 
const cors = require('cors');

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const initializePassport = require('./passport-config')
const { sendPasswordResetEmail,} = require("./models/mailer")
const { findUserByResetToken, resetPassword, clearUserResetToken, setPasswordResetToken, updateUserLoginStatus, getAllUsers, updateUserAdminStatus, createUser, findUserByEmail, findUserById } = require('./models/User');
const { findEventById, createEvent, getAllEvents, getEventsForReview, updateEventStatus, updateEvent } = require('./models/Event');

const app = express();
app.use(cors({
  origin: 'http://localhost:3001', // Update to match the domain you're making the request from
  credentials: true, // Allow cookies to be sent
}));
app.use(express.urlencoded({ extended:false }));
app.use(express.json());
//session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave:false,
  saveUninitialized:false
}));
//passport middleware
app.use(passport.initialize());
app.use(passport.session());
//initialize Passport
initializePassport(passport, findUserByEmail, findUserById);
//define routers
const authRouter = express.Router();
const eventRouter = express.Router();

//use routers
app.use('/api/events', eventRouter);
app.use('/api/auth', authRouter)

//for authRouter
const crypto = require('crypto'); // Node.js built-in module
const bcrypt = require('bcrypt');

//USER Endpoints----------------------------------------------------------------
// Registration endpoint
authRouter.post('/register', async (req, res, next) => {
  try{
    const { 
      first_name, 
      last_name, 
      email, 
      password, 
      user_description, 
      top_music_genres,
    } = req.body;
    if(!first_name || !last_name || !email || !password){
      return res.status(400).json({error: 'Please provide an email and password'});
    }

    const existingUser = await findUserByEmail(email);
    if(existingUser){
      return res.status(400).json({error: 'User already exists'});
    }

    // Check if topMusicGenres is already an array or a string, and handle accordingly
    const genres = Array.isArray(top_music_genres) 
      ? top_music_genres.slice(0, 3) 
      : typeof top_music_genres === 'string'
      ? top_music_genres.split(',').slice(0, 3) 
      : [];

    const newUser = await createUser({
      firstName: first_name,
      lastName: last_name,
      email,
      password,
      userDescription: user_description,
      topMusicGenres: genres,
    });

    const { password: _, ...userWithoutPassword } = newUser;

     res.status(201).json({ 
      message: 'User created successfully',
      user: userWithoutPassword,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred while creating the user' });
  }
});

//checks if user is already logged in
authRouter.get('/session', (req, res) => {
  if (req.isAuthenticated()) {
    // Assuming you send back relevant user information but not sensitive information
    return res.json({ isLoggedIn: true, user: req.user });
  } else {
    return res.json({ isLoggedIn: false });
  }
});

//login user
authRouter.post('/login', (req, res, next) => {
  passport.authenticate('local', async (err, user, info) => {
    if (err) {
      return next(err);
    }
    if (!user) {
      return res.status(401).json({ message: info.message });
    }
    req.logIn(user, async (err) => {
      if (err) {
        return next(err);
      }
   try {
        // Update the is_logged_in property to true upon successful login
        await updateUserLoginStatus(user.id, true);
        return res.json({
          message: 'Logged in successfully',
          user: { 
            id: user.id, 
            first_name: user.first_name, 
            last_name: user.last_name, 
            email: user.email, 
            is_logged_in: user.is_logged_in, 
            is_admin:user.is_admin,
            top_music_genres: user.top_music_genres,
            user_description: user.user_description,
           }
        });
      } catch (updateError) {
        console.error(updateError);
        // Handle error, possibly sending back a 500 server error response
        return next(updateError);
      }
    });
  })(req, res, next);
});

//logout user
authRouter.post('/logout', async (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(403).json({ message: 'Not logged in' });
  }

  try {
    const userId = req.user.id; // Get the user id from the session
    await updateUserLoginStatus(userId, false); // Update logged in status to false

    req.logout(err => {
      if (err) {
        console.error(err);
        return next(err); // Use next to pass the error to your error handling middleware
      }

      req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        return res.status(200).json({ message: 'Logged out successfully' });
      });
    });
  } catch (error) {
    console.error('Error during logout:', error);
    return next(error); // Pass the error to the error handling middleware
  }
});

//get all users
authRouter.get('/users', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) { // Ensure isAdmin logic matches your setup
    return res.status(403).json({ message: 'Not authorized' });
  }

  try {
    const users = await getAllUsers();
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

//forgot password reset link sent to user email
authRouter.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = await findUserByEmail(email);

  if (!user) {
    return res.status(404).json({ message: 'No user found with that email.' });
  }
  // Generate a password reset token
  const resetToken = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(resetToken, Number(process.env.BCRYPT_SALT_ROUNDS));

  // Token expires in one hour
  const expireTime = new Date(Date.now() + 3600000); // 1 hour in milliseconds

  // Save the token and expiration to the database
  await setPasswordResetToken(user.id, hash, expireTime);

  // Send email to the user with the reset link
 try {
    await sendPasswordResetEmail(user.email, resetToken);
    res.json({ message: 'Please check your email for the password reset link.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error sending password reset email.' });
  }
});

//actually reset's password
authRouter.post('/reset-password/:token', async (req, res) => {
  const { email, password } = req.body;
  
  // Check if the token is valid and not expired
  const user = await findUserByEmail(email);
  const savedHash = user.reset_token; // The hash stored in the database
  const { token } = req.params;


  authRouter.post('/reset-password/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const { email, password } = req.body;

    // Check if the token is valid and not expired
    const user = await findUserByEmail(email);

    if (!user || new Date() > new Date(user.reset_token_expires)) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    // Use bcrypt.compare with async/await
    const isMatch = await bcrypt.compare(token, user.reset_token);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid or expired password reset token.' });
    }

    // Hash the new password and save it
    const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS));
    await resetPassword(user.id, hashedPassword);

    // Clear the reset token and expiration from the database
    await clearUserResetToken(user.id);

    res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    res.status(500).json({ message: 'Error resetting password.' });
  }
});


  // Hash the new password and save it
  const hashedPassword = await bcrypt.hash(password, Number(process.env.BCRYPT_SALT_ROUNDS));
  await resetPassword(user.id, hashedPassword);

  // Clear the reset token and expiration from the database
  await clearUserResetToken(user.id);

  res.json({ message: 'Password reset successfully. You can now login with your new password.' });
});

//change admin status
authRouter.patch('/setAdmin/:userId', async (req, res) => {
  if (!req.isAuthenticated() || !req.user.is_admin) {
    return res.status(403).json({ message: 'Not authorized' });
  }

  const { userId } = req.params;
  const { is_admin } = req.body; // Assuming you send {"is_admin": true} or {"is_admin": false}

  try {
    // Assuming updateUserAdminStatus is a function that updates the is_admin field for a user
    const user = await updateUserAdminStatus(userId, is_admin);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({ message: 'User admin status updated successfully', user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
//EVENT Endpoints-----------------------------------------------------

//Submit event
eventRouter.post('/submit', async (req, res) => {
  // Ensure the user is authenticated

  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
 try {
    // Include user_id in the eventData
    const eventData = {
      ...req.body,
      user_id: req.user.id  // Assuming the user object has an id field
    };

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

//edit/update event data.
eventRouter.put('/:eventId', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  
  const { eventId } = req.params;
  const eventData = req.body; // Data to update the event with

  try {
    const updatedEvent = await updateEvent(eventId, eventData);
    if (updatedEvent.length === 0) { // Check if the update was successful
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json({ event: updatedEvent[0], message: 'Event updated successfully.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

//GET Single Event
eventRouter.get('/:eventId', async function(req, res) {
  const { eventId } = req.params;
  try {
    const event = await findEventById(eventId);
    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
  }
})

// GET All Events
eventRouter.get('/', async (req, res) => {
  try {
    const events = await getAllEvents(); 
    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal server error' });
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

