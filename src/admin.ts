import './ui/admin.css';
import { createAdminClient } from './admin/client';
import { QUESTION_BANK } from './content/questions';
import { createAdminPage } from './ui/admin/page';

function fail(message: string): void {
  const box = document.createElement('p');
  box.className = 'fatal';
  box.textContent = message;
  document.body.append(box);
}

try {
  const root = document.getElementById('admin');
  if (root === null) throw new Error('Missing #admin in admin.html');
  const client = createAdminClient(QUESTION_BANK);
  if (client === null) {
    fail('This browser does not support BroadcastChannel, so the admin page cannot talk to the game tab. Use a current Chrome, Edge, Firefox or Safari.');
  } else {
    createAdminPage(root, client, QUESTION_BANK);
  }
} catch (error: unknown) {
  fail(`Admin page could not start: ${error instanceof Error ? error.message : 'unknown error'}`);
}
