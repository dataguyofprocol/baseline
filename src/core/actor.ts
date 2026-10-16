import { AsyncLocalStorage } from 'node:async_hooks';

/** The user a server request acts as. The session middleware runs each request inside it, so
 *  the store attributes writes to the signed-in person without every call passing an id.
 *  Outside a request (the CLI, local single-user mode) it is empty and the store falls back
 *  to the workspace's own `currentUser`. */
export const actingUser = new AsyncLocalStorage<string>();
