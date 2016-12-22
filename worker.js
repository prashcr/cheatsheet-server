'use strict';

const fs = require('fs');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const healthChecker = require('sc-framework-health-check');
const uuid = require('./lib/uuid');
const bcrypt = require('bcrypt');
const MongoClient  = require('mongodb').MongoClient;
const dbUrl = 'mongodb://localhost:27017/cheatsheet';

module.exports.run = async function (worker) {
  const db = await MongoClient.connect(dbUrl);
  const users = db.collection('users');

  console.log('   >> Worker PID:', process.pid);
  const environment = worker.options.environment;

  const app = express();

  const httpServer = worker.httpServer;
  const scServer = worker.scServer;

  if (environment == 'dev') {
    // Log every HTTP request. See https://github.com/expressjs/morgan for other
    // available formats.
    app.use(morgan('dev'));
  }
  app.use(serveStatic(path.resolve(__dirname, 'public')));

  // Add GET /health-check express route
  healthChecker.attach(worker, app);

  httpServer.on('request', app);

  scServer.addMiddleware(scServer.MIDDLEWARE_SUBSCRIBE, function (req, next) {
    const publishOnly = ['saveNote'];
    if (publishOnly.includes(req.channel)) {
      next('Cannot subscribe to channel ' + req.channel);
    }
  });

  scServer.addMiddleware(scServer.MIDDLEWARE_PUBLISH_IN, function (req, next) {
    next();
  });

  /*
    In here we handle our incoming realtime connections and listen for events.
  */
  scServer.on('connection', function (socket) {
    socket.on('login', async function (credentials, respond) {
      let success, error;
      const username = credentials.username;
      const password = credentials.password;
      try {
        const user = await users.findOne({username});
        success = await bcrypt.compare(password, user.hash);
      } catch (e) {
        error = e;
      } finally {
        const isValidLogin = success && !error;
        if (isValidLogin) {
          socket.setAuthToken({username, channels: ['saveNote', 'createNote']});

          respond();
        } else {
          respond('Login failed');
        }
      }
    });

    socket.on('createNote', async function (__, respond) {
      const token = socket.getAuthToken();
      let note, error;
      if (token) {
        note = {
          name: 'Untitled note',
          contents: '',
          updatedAt: Date.now()
        };
        const id = uuid();
        try {
          await users.updateOne({username: token.username}, {$set: {['notes.' + id]: note}});
        } catch (e) {
          error = e;
        } finally {
          if (error) {
            respond(error.message);
          } else {
            note.id = id;
            respond(null, note);
          }
        }
      } else {
        respond('Not authenticated');
      }
    });

    socket.on('saveNote', async function (note, respond) {
      const token = socket.getAuthToken();
      const id = note.id;
      const contents = note.contents;
      delete note.id;
      let error;
      if (token) {
        try {
          await users.updateOne({username: token.username}, {$set: {[`notes.${id}.contents`]: contents}});
        } catch (e) {
          error = e;
        } finally {
          if (error) {
            respond(error.message);
          } else {
            respond();
          }
        }
      } else {
        respond('Not authenticated');
      }
    });

    socket.on('getNotes', async function (__, respond) {
      let user, error;
      try {
        const token = socket.getAuthToken();
        user = await users.findOne({username: token.username});
      } catch (e) {
        error = e
      } finally {
        if (error) {
          respond(error)
        } else {
          respond(null, user.notes);
        }
      }
    });

    socket.on('disconnect', function () {
      // cleanup code in the future
    });
  });
};
