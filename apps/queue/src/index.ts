/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.toml`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
// Imports
// =================================
import { Redis } from '@upstash/redis/cloudflare';
import { Receiver } from '@upstash/qstash';
import { createPublicClient, createWalletClient, defineChain, erc20Abi, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Types
// =================================
export interface Env {
	TELEGRAM_API_TOKEN: string;
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
	CLOUDFLARE_WORKER_QUEUE_URL: string;
	QSTASH_CURRENT_SIGNING_KEY: string;
	QSTASH_NEXT_SIGNING_KEY: string;
}

// Constants
// =================================
/**
 * @dev default Telegram API URL
 */
const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

/**
 * @dev Regex validation patterns
 */
const VALIDATION = {
	token: /^(\$[a-zA-Z]{3,})/, // starts with '$' and is followed by 3+ letters
	number: /^(0(\.0*[1-9]\d{0,17})?|[1-9]\d*(\.\d{1,18})?)$/, // a number that is greater than 0
	address: /^0x[a-fA-F0-9]{40}$/, // evm wallet/token address
};

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

// Helpers
// =================================
/**
 * Helper function that sends a response message to a Telegram chat
 */
const telegramSendMessage = async ({
	endpoint,
	chatId,
	text,
	apiToken,
	params,
}: {
	endpoint: string;
	chatId: string;
	text: string;
	apiToken: string;
	params?: Record<string, any>;
}) => {
	try {
		const url = `${TELEGRAM_API_URL}${apiToken}${endpoint}`;
		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				chat_id: chatId,
				text,
				params,
			}),
		});
		if (response.ok) {
			return new Response(MESSAGES.TELEGRAM.SUCCESS.OK.text, { status: MESSAGES.TELEGRAM.SUCCESS.OK.status });
		}
		return new Response(MESSAGES.TELEGRAM.ERROR.FAILED.text, { status: MESSAGES.TELEGRAM.ERROR.FAILED.status });
	} catch (error) {
		console.error(error);
		return new Response(MESSAGES.TELEGRAM.ERROR.UNKNOWN.text, { status: MESSAGES.TELEGRAM.ERROR.UNKNOWN.status });
	}
};

// Main Worker
// =================================
/**
 * Main worker handler
 * @dev Queue function that handles processing rpc transactions
 */
export default {
	async fetch(request, env, ctx): Promise<Response> {
		const body = await request.text();
		const json: { [key: string]: any } = body ? JSON.parse(body) : {};

		// Signature validation
		const receiver = new Receiver({
			currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
			nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
		});

		const isValid = await receiver
			.verify({
				signature: request.headers.get('Upstash-Signature')!,
				body,
			})
			.catch((err) => {
				console.error(err);
				return false;
			});

		if (!isValid) {
			await telegramSendMessage({
				endpoint: '/sendMessage?parse_mode=markdown',
				chatId: json.chatId,
				text: `Transaction Failed. Invalid signature, please check settings.\n\nFailed transaction:\n\`\`\`\nAddress:\n${json.address}\n\nAmount:\n${json.amount}\n\nToken:\n${json.token}\n\`\`\``,
				apiToken: env.TELEGRAM_API_TOKEN,
			});
		}

		// Perform transaction
		const redis = Redis.fromEnv({
			UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
			UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
		});
		const rpc: { [key: string]: any } | null | undefined = await redis.get('rpc');
		const isValidAddress = VALIDATION?.address.test(json.address);
		const isValidToken = VALIDATION?.token.test(json.token);
		const isValidAmount = VALIDATION?.number.test(json.amount);
		const isValidChatId = VALIDATION?.number.test(json.chatId);
		
		if (
			rpc &&
			typeof rpc === 'object' &&
			Object.keys(rpc).length === 7 &&
			isValidChatId &&
			isValidAddress &&
			isValidAmount &&
			isValidToken
		) {
			try {
				const chain = defineChain({
					id: parseInt(rpc.chainId, 0),
					name: rpc.chainName,
					nativeCurrency: {
						decimals: parseInt(rpc.decimals, 0),
						name: rpc.token,
						symbol: rpc.token,
					},
					rpcUrls: {
						default: {
							http: [rpc.rpcUrl],
						},
					},
					blockExplorers: {
						default: { name: rpc.chainName, url: rpc.blockExplorerUrl },
					},
				});
				const publicClient = createPublicClient({ chain, transport: http() });
				const walletClient = createWalletClient({
					chain,
					transport: http(),
				});

				// Default gas token transfer
				if (rpc.token.toLowerCase() === json.token.toLowerCase()) {
					const txHash = await walletClient.sendTransaction({
						account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
						to: `${json.address}` as `0x${string}`,
						value: BigInt(parseInt(json.amount, 0) * (10 ** parseInt(rpc.decimals, 0))),
					});
					await publicClient.waitForTransactionReceipt({ hash: txHash });
					await telegramSendMessage({
						endpoint: '/sendMessage?parse_mode=markdown',
						chatId: json.chatId,
						text: `Sent \`${json.amount}\` \`${json.token.toUpperCase()}\` to \`${json.address}\`.\n\nTransaction hash:\n\`\`\`\n${rpc.blockExplorerUrl}/tx/${txHash}\n\`\`\``,
						apiToken: env.TELEGRAM_API_TOKEN,
					});
				} else {
					const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
          const token = existingTokens?.[json.token.toLowerCase()];
					const tokenAddress = token.address;

					if (existingTokens && tokenAddress) {
						const txHash = await walletClient.writeContract({
							account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
							address: `${tokenAddress}` as `0x${string}`,
							abi: erc20Abi,
							functionName: 'transfer',
							args: [`${json.address}` as `0x${string}`, BigInt(parseInt(json.amount, 0) * (10 ** parseInt(token.decimals, 0)))],
						});
						await publicClient.waitForTransactionReceipt({ hash: txHash });
						await telegramSendMessage({
							endpoint: '/sendMessage?parse_mode=markdown',
							chatId: json.chatId,
							text: `Sent \`${json.amount}\` \`${json.token.toUpperCase()}\` to \`${json.address}\`.\n\nTransaction hash:\n\`\`\`\n${rpc.blockExplorerUrl}/tx/${txHash}\n\`\`\``,
							apiToken: env.TELEGRAM_API_TOKEN,
						});
					}
				}
			} catch (error) {
				console.error(error);
				// Could not parse json
				await telegramSendMessage({
					endpoint: '/sendMessage?parse_mode=markdown',
					chatId: json.chatId,
					text: `Transaction Failed. RPC Error.\n\nFailed transaction:\n\`\`\`\nAddress:\n${json.address}\n\nAmount:\n${json.amount}\n\nToken:\n${json.token}\n\`\`\``,
					apiToken: env.TELEGRAM_API_TOKEN,
				});
			}
		}

		// Default response
		return new Response(MESSAGES.DEFAULT.SUCCESS.text, { status: MESSAGES.DEFAULT.SUCCESS.status });
	},
} satisfies ExportedHandler<Env>;
