// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from '../src/index';

// Types
// =================================
declare module 'cloudflare:test' {
	interface ProvidedEnv {
		TELEGRAM_API_TOKEN: string;
		UPSTASH_REDIS_REST_URL: string;
		UPSTASH_REDIS_REST_TOKEN: string;
		CLOUDFLARE_WORKER_QUEUE_URL: string;
		UPSTASH_QSTASH_TOKEN: string;
		UPSTASH_QSTASH_QUEUE: string;
	}
}

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

/**
 * @dev Standard messages
 */
const MESSAGES = {
	DEFAULT: {
		SUCCESS: {
			text: 'OK.',
			status: 200,
		},
		ERROR: {
			text: 'Unknown error occurred.',
			status: 500,
		},
	},
	TELEGRAM: {
		SUCCESS: {
			OK: {
				text: 'Message sent successfully!',
				status: 200,
			},
		},
		ERROR: {
			FAILED: {
				text: 'Failed to send message.',
				status: 500,
			},
			UNKNOWN: {
				text: 'Error occurred while sending the message.',
				status: 500,
			},
		},
	},
};

describe('Bot worker', () => {
	/**
	 *
	 */
	it.skip('default reponse with `OK` 200', async () => {
		const request = new IncomingRequest('http://example.com');
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);

		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"${MESSAGES.DEFAULT.SUCCESS.text}"`);
	});

	/**
	 *
	 */
	it('command /start', async () => {
		const request = new IncomingRequest('http://example.com', {
			method: 'POST',
			headers: new Headers({
				'content-type': 'application/json',
			}),
			body: JSON.stringify({
				message: {
					chat: {
						id: 123456789,
					},
				},
			}),
		});
		// Create an empty context to pass to `worker.fetch()`.
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);

		// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
		await waitOnExecutionContext(ctx);
		expect(await response.text()).toMatchInlineSnapshot(`"Hello! I'm a bot."`);
	});

	// it('responds with Hello World! (unit style)', async () => {
	// 	const request = new IncomingRequest('http://example.com');
	// 	// Create an empty context to pass to `worker.fetch()`.
	// 	const ctx = createExecutionContext();
	// 	const response = await worker.fetch(request, env, ctx);
	// 	// Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
	// 	await waitOnExecutionContext(ctx);
	// 	expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	// });

	// it('responds with Hello World! (integration style)', async () => {
	// 	const response = await SELF.fetch('https://example.com');
	// 	expect(await response.text()).toMatchInlineSnapshot(`"Hello World!"`);
	// });
});
