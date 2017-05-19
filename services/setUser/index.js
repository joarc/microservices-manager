const redis = require("redis");
const winston = require("winston");

const client = redis.createClient();

module.exports = function(req, res) {
  const body = req.query;
  client.set("users/"+body.id, body.data, function(err, reply) {
    if (err) winston.error(err);
    return res.json(reply);
  });
}
