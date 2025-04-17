const mongoose = require('mongoose');

const competitionSchema = new mongoose.Schema({
  competitionId: String,
  name: String,
  region: String,
  marketCount: Number
});

module.exports = mongoose.model('Competition', competitionSchema);