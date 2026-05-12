import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, 'data');

function filePath(name) {
  return path.join(DATA, `${name}.json`);
}

function read(name) {
  const fp = filePath(name);
  if (!fs.existsSync(fp)) return [];
  return JSON.parse(fs.readFileSync(fp, 'utf8'));
}

function write(name, data) {
  if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2));
}

// Users
export function getUsers() { return read('users'); }

export function getUserByEmail(email) {
  return getUsers().find(u => u.email === email.toLowerCase()) || null;
}

export function createUser(user) {
  const users = getUsers();
  users.push({ ...user, email: user.email.toLowerCase(), createdAt: new Date().toISOString() });
  write('users', users);
}

export function setUserVerified(email) {
  const users = getUsers();
  const u = users.find(u => u.email === email.toLowerCase());
  if (u) { u.verified = true; write('users', users); }
}

// Letters
export function getLetters() { return read('letters'); }

export function getLettersByUser(email) {
  return getLetters().filter(l => l.email === email.toLowerCase());
}

export function createLetter(letter) {
  const letters = getLetters();
  const id = Date.now().toString();
  letters.push({ ...letter, email: letter.email.toLowerCase(), id, sent: false, createdAt: new Date().toISOString() });
  write('letters', letters);
  return id;
}

export function markLetterSent(id) {
  const letters = getLetters();
  const l = letters.find(l => l.id === id);
  if (l) { l.sent = true; write('letters', letters); }
}

// Stories
export function getStories() { return read('stories'); }

export function getPublicStories() {
  return getStories().filter(s => s.visibility === 'public');
}

export function createStory(story) {
  const stories = getStories();
  const id = Date.now().toString();
  stories.push({ ...story, id, createdAt: new Date().toISOString() });
  write('stories', stories);
  return id;
}
