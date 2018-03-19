'use strict';

const client = require('../db-client');

client.query(`
    CREATE TABLE IF NOT EXISTS users (
        user_id SERIAL PRIMARY KEY,
        username VARCHAR(15) NOT NULL UNIQUE,
        token TEXT(50) NOT NULL UNIQUE,
        password VARCHAR(15) NOT NULL
    );
`)
    .then(
        () => console.log('user table loaded'),
        err => console.error(err)
    );

client.query(`
    CREATE TABLE IF NOT EXISTS spots (
        spot_id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        user_id INT references users(user_id),
        location VARCHAR(255) NOT NULL,
        note TEXT(200),
        date DATE NOT NULL,
    );
`)
    .then(
        () => console.log('spot table loaded'),
        err => console.error(err)
    )
    .then( () => client.end());