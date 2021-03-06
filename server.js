'use strict';

const dotenv = require('dotenv');
dotenv.config();

const PORT = process.env.PORT;
const TOKEN_KEY = process.env.TOKEN_KEY;

const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const app = express();

app.use(morgan('dev'));
app.use(cors());

app.use(express.json());
app.use(express.urlencoded({ extended:true }));

const client = require('./db-client');

function validateUser(request, response, next) {
    const token = request.get('token');
    if(!token) next({ status: 401, message: 'please sign in' });

    let decoded;
    try {
        decoded = jwt.verify(token, TOKEN_KEY);
    } catch(err) {
        return next({ status: 403, message: 'not permitted' });
    }

    request.user_id = decoded.id;
    next();
}

function makeToken(id) {
    return jwt.sign({ id: id }, TOKEN_KEY);
}

app.post('/api/v1/auth/signup', (request, response, next) => {
    const credentials = request.body;
    if(!credentials.username || !credentials.password) {
        return next({ status: 400, message: 'username and password required'});
    }

    client.query(`
        SELECT user_id
        FROM users
        WHERE username=$1;
   `,
    [credentials.username]
    )
        .then(result => {
            if(result.rows.length !== 0) {
                return next({ status: 400, message: 'username taken' });
            }

            return client.query(`
                INSERT INTO users (username, password)
                VALUES ($1, $2)
                RETURNING user_id, username;
            `,
            [credentials.username, credentials.password]
            );
        })
        .then(result => {
            const user_id = result.rows[0].user_id;
            response.json({
                token: makeToken(user_id),
                user_id: user_id,
                username: result.rows[0].username
            });
        })
        .catch(next);
});

app.post('/api/v1/auth/signin', (request, response, next) => {
    const credentials = request.body;
    if(!credentials.username || !credentials.password) {
        return next ({ status: 400, message: 'username and password required' });
    }

    client.query(`
        SELECT user_id, password, username
        FROM users
        WHERE username=$1;
    `,
    [credentials.username]
    )
        .then(result => {
            if(result.rows.length === 0 || result.rows[0].password !== credentials.password) {
                return next({ status: 401, message: 'invalid username or password' });
            }
            const user_id = result.rows[0].user_id;
            response.json({
                token: makeToken(user_id),
                user_id: user_id,
                username: result.rows[0].username
            });
        });
});

app.get('/api/v1/spots', (request, response, next) => {
    client.query(`
        SELECT spots.name, spots.address, spots.lat, spots.lng, spots.note, spots.date, spots.spot_id, users.username, been_nums.count AS "beenHereCount", good_nums.count AS "goodSpotCount"
        FROM spots
        INNER JOIN users
        ON (spots.user_id = users.user_id)
        LEFT JOIN (SELECT been.spot_id, COUNT(been.spot_id) FROM been GROUP BY been.spot_id) AS been_nums
        ON been_nums.spot_id = spots.spot_id
        LEFT JOIN (SELECT good.spot_id, COUNT(good.spot_id) FROM good GROUP BY good.spot_id) AS good_nums
        ON good_nums.spot_id = spots.spot_id
        ORDER BY spots.name ASC;
    `)
        .then(result => response.send(result.rows))
        .catch(next);
});

app.get('/api/v1/spots/:id', (request, response, next) => {
    const id = request.params.id;
    client.query(`
        SELECT spots.name, spots.address, spots.note, spots.date, spots.spot_id, users.username, been_nums.count AS "beenHereCount", good_nums.count AS "goodSpotCount"
        FROM spots
        INNER JOIN users
        ON (spots.user_id = users.user_id)
        LEFT JOIN (SELECT been.spot_id, COUNT(been.spot_id) FROM been GROUP BY been.spot_id) AS been_nums
        ON been_nums.spot_id = spots.spot_id
        LEFT JOIN (SELECT good.spot_id, COUNT(good.spot_id) FROM good GROUP BY good.spot_id) AS good_nums
        ON good_nums.spot_id = spots.spot_id
        WHERE spots.spot_id = $1;
    `,
    [id]
    )
        .then(result => {
            if(result.rows.length === 0) next({ status: 404, message: `Spot id ${id} does not exist`});
            else response.send(result.rows[0]);
        })
        .catch(next);
});

function insertSpot(spot, user_id) {
    return client.query(`
        INSERT INTO spots (name, user_id, address, lat, lng, note, date)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
    `,
    [spot.name, user_id, spot.address, spot.lat, spot.lng, spot.note, new Date(spot.date)]
    )
        .then(result => result.rows[0]);
}

app.post('/api/v1/spots/new', validateUser, (request, response, next) => {
    const body = request.body;
    const user_id = request.user_id;

    insertSpot(body, user_id)
        .then(result => response.send(result))
        .catch(next);
});

app.put('/api/v1/spots/:id', validateUser, (request, response, next) => {
    const body = request.body;
    const spot_id = request.params.id;

    client.query(`
        SELECT user_id FROM spots
        WHERE spot_id=$1;
    `,
    [spot_id]
    )
        .then(result => {
            if(result.rows[0].user_id !== request.user_id) {
                return next({ status: 403, message: 'You may only update spots you created'});
            }
            return client.query(`
                UPDATE spots
                SET note=$1
                WHERE spot_id=$2
                RETURNING note;
            `,
            [body.note, spot_id]
            );
        })
        .then(result => response.send(result.rows[0]))
        .catch(next);

});

app.delete('/api/v1/spots/:id', validateUser, (request, response, next) => {
    const spot_id = request.params.id;

    client.query(`
        SELECT user_id FROM spots
        WHERE spot_id=$1;
    `,
    [spot_id]
    )
        .then(result => {
            if (result.rows[0].user_id !== request.user_id) {
                return next({ status: 403, message: 'you may only delete spots you created' });
            }
            return client.query(`
                DELETE FROM spots
                WHERE spot_id=$1
                RETURNING name;
            `,
            [spot_id]
            );
        })
        .then(result => response.send({ removed: result.rows[0].name }))
        .catch(next);
});

app.get('/api/v1/check/:id/votes', validateUser, (request, response, next) => {
    const spot_id = request.params.id;

    client.query(`
        SELECT been.user_id, been.spot_id AS "beenHere", good_results.spot_id AS "likedHere"
        FROM been
        FULL JOIN (SELECT good.spot_id, COUNT(*) FROM good WHERE good.user_id = $1 AND good.spot_id = $2 GROUP BY good.spot_id) AS good_results
        ON (been.spot_id = good_results.spot_id)
        WHERE been.user_id = $1 AND been.spot_id = $2;
    `,
    [request.user_id, spot_id]
    )
        .then(result => response.send(result))
        .catch(next);
});

app.get('/api/v1/check/votes', validateUser, (request, response, next) => {

    client.query(`
        SELECT ARRAY(SELECT spot_id FROM been WHERE user_id = $1) AS "beenArray",
        ARRAY(SELECT spot_id FROM good WHERE user_id = $1) AS "goodArray";
    `,
    [request.user_id]
    )
        .then(result => response.send(result))
        .catch(next);
});

app.post('/api/v1/spots/:id/been', validateUser, (request, response, next) => {
    postVotes(request, response, next, 'been', 'you have already reported being here');
});

app.post('/api/v1/spots/:id/good', validateUser, (request, response, next) => {
    postVotes(request, response, next, 'good', 'you have already liked this tip');
});

function postVotes(request, response, next, table, message) {
    const user_id = request.user_id;
    const spot_id = request.params.id;
    
    client.query(`
        SELECT * FROM ${table}
        WHERE user_id=$1 AND spot_id=$2;
    `,
    [user_id, spot_id]
    )
        .then(result => {
            if(result.rows.length !== 0) {
                return next({ status: 403, message: message});
            }
            return client.query(`
                INSERT INTO ${table} (user_id, spot_id)
                VALUES ($1, $2);
            `,
            [user_id, spot_id]
            );
        })
        .then(result => response.send(result))
        .catch(next);
}

app.use((err, request, response, next) => { // eslint-disable-line
    console.error(err);

    if(err.status) {
        response.status(err.status).send({ error: err.message });
    }
    else {
        response.sendStatus(500);
    }
});

app.listen(PORT, () => {
    console.log('Server running on port', PORT);
});