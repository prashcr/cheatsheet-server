'use strict';

const fs = require('fs');
const express = require('express');
const serveStatic = require('serve-static');
const path = require('path');
const morgan = require('morgan');
const healthChecker = require('sc-framework-health-check');
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

  /*
    In here we handle our incoming realtime connections and listen for events.
  */
  scServer.on('connection', function (socket) {
    socket.on('login', async function (credentials, respond) {
      let success, error;
      try {
        const {username, password} = credentials;
        const {hash} = await users.findOne({username});
        success = await bcrypt.compare(password, hash);
      } catch (e) {
        error = e;
      } finally {
        if (error || !success) {
          respond('Login failed');
        } else {
          respond('Login success');
        }
      }
    });

    socket.on('saveNote', async function (note, respond) {
      // TODO save note;
    });

    socket.on('disconnect', function () {
      clearInterval(interval);
    });
  });
};
