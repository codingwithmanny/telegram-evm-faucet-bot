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
import { createPublicClient, formatUnits, http, defineChain, erc20Abi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

// Types
// =================================
export interface Env {
	TELEGRAM_API_TOKEN: string;
	UPSTASH_REDIS_REST_URL: string;
	UPSTASH_REDIS_REST_TOKEN: string;
	CLOUDFLARE_WORKER_QUEUE_URL: string;
	UPSTASH_QSTASH_TOKEN: string;
	QSTASH_QUEUE: string;
}

// Constants
// =================================
/**
 * @dev default Telegram API URL
 */
const TELEGRAM_API_URL = 'https://api.telegram.org/bot';

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

/**
 * @dev Regex validation patterns
 */
const VALIDATION = {
	url: /^(http|https):\/\/[^ "]+$/, // url
	username: /^@[a-zA-Z0-9_]{3,}$/,
	token: /^(\$[a-zA-Z]{4,5})/, // starts with '$' and is followed by 4-5 letters
	number: /^[1-9]\d*$/, // an integer number that is greater than 0
	address: /^0x[a-fA-F0-9]{40}$/, // evm wallet/token address
	textOnly: /^[^0-9][a-zA-Z]/,
	pk: /^(0x)?[0-9a-fA-F]{64}$/,
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
 */
export default {
	async fetch(request, env, _ctx): Promise<Response> {
		// Get request details
		const { method, headers } = request;

		if (method === 'POST' && headers.get('content-type') === 'application/json') {
			const data: any = await request.json();
			const message = data?.message ?? data?.callback_query?.message;
			const chatId = message?.chat?.id;

			// DEBUG - comment/uncomment for debugging
			// console.log({ data });

			// Validate if message and chatId are present otherwise ignore and continue
			if (message && chatId) {
				const redis = Redis.fromEnv({
					UPSTASH_REDIS_REST_URL: env.UPSTASH_REDIS_REST_URL,
					UPSTASH_REDIS_REST_TOKEN: env.UPSTASH_REDIS_REST_TOKEN,
				});
				const superAdmin = await redis.get('superadmin');
				const admin = await redis.get(`admin/${message.from.username}`);
				const rpc: { [key: string]: any } | null | undefined = await redis.get('rpc');
				const isAdmin = message.from.username === superAdmin || Boolean(admin);
				const hasSuperAdminAndRpc = Boolean(superAdmin) && !!rpc;
				const [command, ...params] = message.text.trim().split(' ');

				let chain = undefined;
				if (rpc && typeof rpc === 'object' && Object.keys(rpc).length === 7) {
					try {
						if (Object.keys(rpc).length === 7) {
							chain = defineChain({
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
						}
					} catch (error) {
						console.error(error);
						// Could not parse json
					}
				}

				switch (command) {
					/**
					 * @dev Sets superadmin if not already set
					 */
					case '/start':
						if (!superAdmin) {
							await redis.set('superadmin', message.from.username);
							await telegramSendMessage({
								endpoint: '/sendMessage',
								chatId,
								text: `Superadmin \`${message.from.username}\` has been set.`,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						}
						break;
					/**
					 * @dev Manages rpc values
					 */
					case '/rpc':
						// If admin set RPC values
						if (params[0] === 'set' && isAdmin) {
							try {
								const values = [...params].slice(1);

								// Validation
								if (
									values.length !== 7 ||
									!VALIDATION?.number.test(values[0]) || // chain id
									!VALIDATION?.textOnly.test(values[1]) || // chain name
									!VALIDATION?.url.test(values[2]) || // rpc url
									!VALIDATION?.token.test(values[3]) || // token starting with $
									!VALIDATION?.number.test(values[4]) || // decimals
									!VALIDATION?.url.test(values[5]) || // block explorer url
									!VALIDATION?.pk.test(values[6]) // private key test
								) {
									throw Error('Invalid RPC values.');
								}

								const publicClient = createPublicClient({
									chain: defineChain({
										id: parseInt(values[0], 0),
										name: values[1],
										nativeCurrency: {
											decimals: parseInt(values[4], 0),
											name: values[3],
											symbol: values[3],
										},
										rpcUrls: {
											default: {
												http: [values[2]],
											},
										},
										blockExplorers: {
											default: { name: values[1], url: values[5] },
										},
									}),
									transport: http(),
								});
								const chainId = await publicClient.getChainId();
								const account = privateKeyToAccount(values[6]);
								if (chainId !== parseInt(values[0], 0)) {
									throw Error('Invalid chain id.');
								}

								const validatedValues = values.map((value: string, index: number) => {
									// get last character of the string
									if (index === 2 || index === 5) {
										const lastChar = value.charAt(value.length - 1);
										if (lastChar === '/') {
											return value.slice(0, -1);
										}
									}
									return value;
								});

								await redis.set(
									'rpc',
									`${JSON.stringify({
										chainId: parseInt(validatedValues[0], 0),
										chainName: validatedValues[1],
										rpcUrl: validatedValues[2],
										token: validatedValues[3],
										decimals: parseInt(validatedValues[4], 0),
										blockExplorerUrl: validatedValues[5],
										privateKey: validatedValues[6],
									})}`,
								);

								await telegramSendMessage({
									endpoint: '/sendMessage?parse_mode=markdown',
									chatId,
									text: `RPC set successfully.\n\`\`\`\n${validatedValues.map((value: string, index: number) => (index === 6 ? account.address : value)).join('\n')}\n\`\`\``,
									apiToken: env.TELEGRAM_API_TOKEN,
								});
							} catch (error) {
								console.error(error);
								await telegramSendMessage({
									endpoint: '/sendMessage?parse_mode=markdown',
									chatId,
									text: `Invalid RPC values.\n\`\`\`bash\n\# Example:\n/rpc set 1 chainName http://example.com $abcd 1000 http://example.com\`\`\``,
									apiToken: env.TELEGRAM_API_TOKEN,
								});
							}
						} else if (hasSuperAdminAndRpc) {
							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `RPC values are:\n\`\`\`\n${rpc.chainId}\n${rpc.chainName}\n${rpc.rpcUrl}\n${rpc.token}\n${rpc.decimals}\n${rpc.blockExplorerUrl}\n${privateKeyToAccount(rpc.privateKey).address}\n\n\`\`\``,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						}
						break;
					/**
					 * @dev Manage admin
					 */
					case '/admin':
						// Validation
						const isValidUsername = params[1] && VALIDATION?.username.test(params[1]);
						if (params[0] === 'add' && hasSuperAdminAndRpc && isValidUsername) {
							await redis.set(`admin/${params[1]}`, 'true');
							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `Admin ${params[1]} has been added.`,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						} else if (params[0] === 'remove' && hasSuperAdminAndRpc && isValidUsername) {
							await redis.del(`admin/${params[1]}`);
							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `Admin ${params[1]} has been removed.`,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						} else if (params[0] === 'check' && superAdmin && isValidUsername) {
							const admin = await redis.get(`admin/${params[1]}`);
							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `Admin ${params[1]} is ${admin ? 'an' : 'not an'} admin.`,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						}
						break;
					/**
					 * @dev Gets faucet status for native or other erc20 tokens
					 */
					case '/status':
						if (params[0] && hasSuperAdminAndRpc && params[0].toLowerCase() !== rpc.token.toLowerCase()) {
							// Validation
							const isValidToken = VALIDATION?.token.test(params[0]);
							const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
							const tokenAddress = existingTokens?.[params[0].toLowerCase()];
							if (!isValidToken || !tokenAddress) break;

							try {
								const publicClient = createPublicClient({ chain, transport: http() });
								const account = privateKeyToAccount(rpc.privateKey as `0x${string}`);
								const tokenBalance = await publicClient.readContract({
									address: tokenAddress,
									abi: erc20Abi,
									functionName: 'balanceOf',
									args: [account.address],
								});

								await telegramSendMessage({
									endpoint: '/sendMessage?parse_mode=markdown',
									chatId,
									text: `Faucet \`${params[0].toUpperCase()}\` status:\n\`\`\`\nFaucet Address:\n${account.address}\n\nBalance:\n${formatUnits(tokenBalance, parseInt(rpc.decimals, 0))} ${params[0].toUpperCase()}\n(${tokenAddress})\n\n\`\`\``,
									apiToken: env.TELEGRAM_API_TOKEN,
								});
							} catch (error) {
								// Likely RPC error
								console.error(error);
							}
						} else if (hasSuperAdminAndRpc) {
							try {
								const publicClient = createPublicClient({ chain, transport: http() });
								const account = privateKeyToAccount(rpc.privateKey as `0x${string}`);
								const balance = await publicClient.getBalance({
									address: account.address,
								});
								await telegramSendMessage({
									endpoint: '/sendMessage?parse_mode=markdown',
									chatId,
									text: `Faucet status:\n\`\`\`\nFauce Address:\n${account.address}\n\nBalance:\n${formatUnits(balance, parseInt(rpc.decimals, 0))} ${rpc.token}\n\`\`\``,
									apiToken: env.TELEGRAM_API_TOKEN,
								});
							} catch (error) {
								// Likely RPC error
								console.error(error);
							}
						}
						break;
					/**
					 * @dev manages whitelisting erc20 addresses for faucet
					 */
					case '/tokens':
						if (params[0] === 'add' && isAdmin && hasSuperAdminAndRpc) {
							// Validation
							const isNotNativeToken = params[0] !== rpc.token;
							const isValidToken = params.length === 3 && VALIDATION?.token.test(params[1]) && VALIDATION?.address.test(params[2]);
							if (!isNotNativeToken || !isValidToken) break;

							const existingTokens = (await redis.get('tokens')) || {};
							await redis.set('tokens', { ...existingTokens, [params[1].toLowerCase()]: params[2] });
							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `Token \`${params[1].toUpperCase()}\` successfully added as:\n\`\`\`bash\n${params[2]}\n\`\`\``,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						} else if (params[0] === 'remove' && isAdmin && hasSuperAdminAndRpc) {
							// Validation
							const isNotNativeToken = params.length === 2 && params[1] !== rpc.token;
							const isValidToken = params.length === 2 && VALIDATION?.token.test(params[1]);
							if (!isNotNativeToken || !isValidToken) break;

							const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
							const token = params[1].toLowerCase();
							if (existingTokens?.[token]) {
								delete existingTokens[token];
								await redis.set('tokens', existingTokens);
								await telegramSendMessage({
									endpoint: '/sendMessage?parse_mode=markdown',
									chatId,
									text: `Token \`${params[1].toUpperCase()}\` successfully removed from tokens.`,
									apiToken: env.TELEGRAM_API_TOKEN,
								});
							}
						} else if (!['add', 'remove'].includes(params[0]) && hasSuperAdminAndRpc) {
							const tokens = (await redis.get('tokens')) || {};
							const tokenValues = Object.entries({ [rpc.token]: 'Native gas token.', ...tokens }).map(
								([key, value], index) => `${index !== 0 ? '\n\n' : ''}${key.toUpperCase()}:\n${value}`,
							);

							await telegramSendMessage({
								endpoint: '/sendMessage?parse_mode=markdown',
								chatId,
								text: `Tokens are:\n\`\`\`\n${tokenValues.toString().replace(',', '')}\n\`\`\`\n`,
								apiToken: env.TELEGRAM_API_TOKEN,
							});
						}
						break;
					/**
					 * @dev Admin sends native or erc20 tokens to an address
					 */
					case '/send':
						const isValidAddress = VALIDATION?.address.test(params[0]);
						const isValidInteger = VALIDATION?.number.test(params[1]);
						const isValidToken = VALIDATION?.token.test(params[2]);
						const token = isValidToken ? params[2].toLowerCase() : hasSuperAdminAndRpc && rpc.token.toLowerCase();
						const fetchURL = `https://qstash.upstash.io/v2/enqueue/${env.QSTASH_QUEUE}/${env.CLOUDFLARE_WORKER_QUEUE_URL}`;

						if (hasSuperAdminAndRpc && isAdmin && params.length >= 2 && isValidAddress && isValidInteger) {
							if (rpc.token.toLowerCase() !== token) {
								const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
								const tokenAddress = existingTokens?.[token];
								if (!tokenAddress || !isValidToken) break;
							}

							await fetch(fetchURL, {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
									'Upstash-Retries': '0',
									Authorization: `Bearer ${env.UPSTASH_QSTASH_TOKEN}`,
								},
								body: JSON.stringify({
									chatId,
									address: params[0],
									amount: params[1],
									token,
								})
							});
						}


						// if (isERC20Transfer) {
						// 	// Validation
						// 	const isValidToken = VALIDATION?.token.test(params[2]);
						// 	const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
						// 	const tokenAddress = existingTokens?.[params[2].toLowerCase()];
						// 	if (!tokenAddress || !isValidToken) break;

						// 	console.log({ fetchURL });
						// 	const result = await fetch(fetchURL, {
						// 		method: 'POST',
						// 		headers: {
						// 			'Content-Type': 'application/json',
						// 			'Upstash-Retries': '0',
						// 			Authorization: `Bearer ${env.UPSTASH_QSTASH_TOKEN}`,
						// 		},
						// 		body: JSON.stringify({
						// 			chatId,
						// 			address: params[0],
						// 			amount: params[1],
						// 			token: params[2],
						// 		}),
						// 	});
						// } else if (isGasTokenTransfer) {
						// }
						// // @TODO send to queue
						// const isValidAddress = VALIDATION?.address.test(params[0]);
						// const isValidInteger = VALIDATION?.number.test(params[1]);
						// if (hasSuperAdminAndRpc && isAdmin && params.length === 3 && isValidAddress && isValidInteger) {
						// 	// Validation
						// 	const isValidToken = VALIDATION?.token.test(params[2]);
						// 	const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
						// 	const tokenAddress = existingTokens?.[params[2].toLowerCase()];
						// 	if (!tokenAddress || !isValidToken) break;

						// 	try {
						// 		const publicClient = createPublicClient({ chain, transport: http() });
						// 		const walletClient = createWalletClient({
						// 			chain,
						// 			transport: http(),
						// 		});

						// 		const txHash = await walletClient.writeContract({
						// 			account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
						// 			address: `${tokenAddress}` as `0x${string}`,
						// 			abi: erc20Abi,
						// 			functionName: 'transfer',
						// 			args: [`${params[0]}` as `0x${string}`, BigInt(parseInt(params[1], 0) * 1000000000000000000)],
						// 		});
						// 		await publicClient.waitForTransactionReceipt({ hash: txHash });
						// 		await telegramSendMessage({
						// 			endpoint: '/sendMessage?parse_mode=markdown',
						// 			chatId,
						// 			text: `Sent \`${params[1]}\` \`${params[2].toUpperCase()}\` to \`${params[0]}\`.\n\nTransaction hash:\n\`\`\`\n${rpc.blockExplorerUrl}/tx/${txHash}\n\`\`\``,
						// 			apiToken: env.TELEGRAM_API_TOKEN,
						// 		});
						// 	} catch (error) {
						// 		console.error(error);
						// 		// Likely RPC error
						// 	}
						// } else if (hasSuperAdminAndRpc && isAdmin && params.length === 2 && isValidAddress && isValidInteger) {
						// 	try {
						// 		const publicClient = createPublicClient({ chain, transport: http() });
						// 		const walletClient = createWalletClient({
						// 			chain,
						// 			transport: http(),
						// 		});
						// 		const txHash = await walletClient.sendTransaction({
						// 			account: privateKeyToAccount(rpc.privateKey as `0x${string}`),
						// 			to: `${params[0]}` as `0x${string}`,
						// 			value: BigInt(parseInt(params[1], 0) * 1000000000000000000),
						// 		});
						// 		await publicClient.waitForTransactionReceipt({ hash: txHash });
						// 		await telegramSendMessage({
						// 			endpoint: '/sendMessage?parse_mode=markdown',
						// 			chatId,
						// 			text: `Sent \`${params[1]}\` \`${rpc.token}\` to \`${params[0]}\`.\n\nTransaction hash:\n\`\`\`\n${rpc.blockExplorerUrl}/tx/${txHash}\n\`\`\``,
						// 			apiToken: env.TELEGRAM_API_TOKEN,
						// 		});
						// 	} catch (error) {
						// 		console.error(error);
						// 		// Likely RPC error
						// 	}
						// }
						break;
					default:
					// Nothing
				}
			}
		}

		// Default response
		return new Response(MESSAGES.DEFAULT.SUCCESS.text, { status: MESSAGES.DEFAULT.SUCCESS.status });
	},
} satisfies ExportedHandler<Env>;
