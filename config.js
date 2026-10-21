// Ballot Match settings.
//
// CIVIC_API_KEY: paste your Google Civic Information API key between the quotes
// to load real ballots. Leave it empty to run on the demo ballot.
// See README.md, "Turn on live ballots", for how to create and restrict the key.
//
// ELECTION_ID: leave empty to use the next upcoming election for the voter's
// address. To force one, use an id from
// https://www.googleapis.com/civicinfo/v2/elections?key=YOUR_KEY

export const CONFIG = {
  CIVIC_API_KEY: '',
  ELECTION_ID: '',
};
