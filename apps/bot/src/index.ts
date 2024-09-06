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
	UPSTASH_QSTASH_QUEUE: string;
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
	token: /^(\$[a-zA-Z]{1,})/, // starts with '$' and is followed by 1+ letters
	number: /^(0(\.0*[1-9]\d{0,17})?|[1-9]\d*(\.\d{1,18})?)$/, // a number that is greater than 0
	address: /^0x[a-fA-F0-9]{40}$/, // evm wallet/token address
	textOnly: /^[^0-9][a-zA-Z]/,
	time: /^\d+[mh]$/, // handles minutes and hours e.g. 1m, 24h
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
				const isSuperAdmin = message.from.username === superAdmin;
				const isAdmin = isSuperAdmin || Boolean(admin);
				const hasSuperAdminAndRpc = Boolean(superAdmin) && !!rpc;
				const [command, ...params] = message.text
					.trim()
					.split(' ')
					.filter((i: any) => i);

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

				// Telegram message to send to handler
				let telegramText = '';

				// Main commands for bot
				switch (command) {
					/**
					 * @dev Sets superadmin if not already set
					 * @dev DO THIS FIRSAT
					 */
					case '/start':
						if (!superAdmin) {
							await redis.set('superadmin', message.from.username);
							telegramText = `Superadmin \`${message.from.username}\` has been set. Type \`/help\` to see all the commands.`;
						} else {
							telegramText = `Start by runnig \`/help\` to see all the commands.`;
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

								telegramText = `RPC set successfully.\n\`\`\`\n${validatedValues.map((value: string, index: number) => (index === 6 ? account.address : value)).join('\n')}\n\`\`\``;
							} catch (error) {
								console.error(error);

								telegramText = `Invalid RPC values.\n\`\`\`bash\n\# Example:\n/rpc set 1 chainName http://example.com $abcd 1000 http://example.com\`\`\``;
							}
						} else if (hasSuperAdminAndRpc) {
							telegramText = `RPC values are:\n\`\`\`\n${rpc.chainId}\n${rpc.chainName}\n${rpc.rpcUrl}\n${rpc.token}\n${rpc.decimals}\n${rpc.blockExplorerUrl}\n${privateKeyToAccount(rpc.privateKey).address}\n\n\`\`\``;
						}
						break;
					/**
					 * @dev Manage admin
					 */
					case '/admin':
						// Validation
						const isValidUsername = params[1] && VALIDATION?.username.test(params[1]);
						if (params[0] === 'add' && hasSuperAdminAndRpc && isValidUsername) {
							await redis.set(`admin/${params[1].replace('@', '')}`, 'true');
							telegramText = `Admin ${params[1]} has been added.`;
						} else if (params[0] === 'remove' && hasSuperAdminAndRpc && isValidUsername) {
							await redis.del(`admin/${params[1].replace('@', '')}`);
							telegramText = `Admin ${params[1]} has been removed.`;
						} else if (params[0] === 'check' && superAdmin && isValidUsername) {
							const admin = await redis.get(`admin/${params[1].replace('@', '')}`);
							telegramText = `Admin ${params[1]} is ${admin ? 'an' : 'not an'} admin.`;
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
							const token = existingTokens?.[params[0].toLowerCase()];
							const tokenAddress = token?.address;
							if (!isValidToken || !tokenAddress) {
								telegramText = `Invalid token or not found \`${params[0].toUpperCase()}\`.`;
								break;
							}

							try {
								const publicClient = createPublicClient({ chain, transport: http() });
								const account = privateKeyToAccount(rpc.privateKey as `0x${string}`);
								const tokenBalance = await publicClient.readContract({
									address: tokenAddress,
									abi: erc20Abi,
									functionName: 'balanceOf',
									args: [account.address],
								});

								telegramText = `Faucet \`${params[0].toUpperCase()}\` status:\n\`\`\`\nFaucet Address:\n${account.address}\n\nBalance:\n${formatUnits(tokenBalance, parseInt(token.decimals, 0))} ${params[0].toUpperCase()}\n(${tokenAddress})\n\n\`\`\``;
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

								telegramText = `Faucet status:\n\`\`\`\nFaucet Address:\n${account.address}\n\nBalance:\n${formatUnits(balance, parseInt(rpc.decimals, 0))} ${rpc.token}\n\`\`\``;
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
							const isValidToken = VALIDATION?.token.test(params[1]) && VALIDATION?.address.test(params[2]);
							if (!isNotNativeToken || !isValidToken) break;

							const existingTokens = (await redis.get('tokens')) || {};
							await redis.set('tokens', {
								...existingTokens,
								[params[1].toLowerCase()]: {
									address: params[2],
									decimals: params[3] ?? 18,
								},
							});

							telegramText = `Token \`${params[1].toUpperCase()}\` successfully added as:\n\`\`\`bash\n${params[2]}\n\`\`\``;
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

								telegramText = `Token \`${params[1].toUpperCase()}\` successfully removed from tokens.`;
							}
						} else if (!['add', 'remove'].includes(params[0]) && hasSuperAdminAndRpc) {
							const tokens: { [key: string]: { address?: string; decimals?: number } | undefined } = {
								[rpc.token]: {
									address: 'Native gas token.',
									decimals: rpc.decimals,
								},
								...((await redis.get('tokens')) || {}),
							};
							const tokenValues = Object.entries(tokens).map(
								([key, value], index) => `${index !== 0 ? '\n\n' : ''}${key.toUpperCase()}:\n${value?.address}\n${value?.decimals}`,
							);

							telegramText = `Tokens are:\n\`\`\`\n${tokenValues.toString().replaceAll(',', '')}\n\`\`\`\n`;
						}
						break;
					/**
					 * @dev Admin sends native or erc20 tokens to an address
					 */
					case '/send':
						const isValidAddress = VALIDATION?.address.test(params[0]);
						const isValidInteger = VALIDATION?.number.test(params[1]);
						const isValidToken = VALIDATION?.token.test(params[2]?.toLowerCase());
						const token = isValidToken ? params[2]?.toLowerCase() : undefined;
						const fetchURL = `https://qstash.upstash.io/v2/enqueue/${env.UPSTASH_QSTASH_QUEUE}/${env.CLOUDFLARE_WORKER_QUEUE_URL}`;

						if (hasSuperAdminAndRpc && isAdmin && params.length >= 2 && isValidAddress && isValidInteger && token) {
							if ((rpc?.token ?? '').toLowerCase() !== token) {
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
								}),
							});

							telegramText = `Sending...\n\`\`\`\n${params[1]} ${token.toUpperCase()} to ${params[0]}\n\`\`\``;
						} else if (!isValidAddress || !isValidInteger || !isValidToken || !token) {
							telegramText = `Invalid send command.\n\`\`\`bash\n# Example:\n/send 0x1234567890abcdef 100 $abcd\n\`\`\``;
						}
						break;
					/**
					 * @dev Displays set of commands and examples
					 */
					case '/help':
						const helpText =
							`These are the following commands and examples:\n\n` +
							`/start - Sets superadmin (only once)\n\n\n` +
							`/rpc - Retrieves current RPC settings\n` +
							`/rpc set - (Admin Only) Sets RPC values & Private key\n\`\`\`\n` +
							`/rpc set 1 chainName http://example.com $abcd 18 http://example.com 0x1234567890abcdef\n\`\`\`\n\n` +
							`/admin check @username - (Admin Only) Checks if user is an admin\n` +
							`/admin add @username - (Admin Only) Adds an admin to send tokens\n` +
							`/admin remove @username - (Admin Only) Removes an admin\n\n` +
							`/status - Checks faucet status for native gas token\n` +
							`/status $token - Checks faucet status for erc20 token\n\n` +
							`/send 0xAddress amount $token - (Admin Only) Sends native or erc20 tokens to an address\n\`\`\`\n` +
							`/send 0x1234567890abcdef 100 $abcd\n\`\`\`\n\n` +
							`/tokens - (Admin Only) Lists all tokens\n` +
							`/tokens add $token 0xAddress 18 - (Admin Only) Adds erc20 token to whitelist <$token> <0xAddress> <decimals>\n` +
							`/tokens remove $token - (Admin Only) Removes erc20 token from whitelist` +
							`/superadmin - (Superadmin Only) Returns current superadmin\n\`\`\`\n` +
							`/superadmin set @username - (Superadmin) Transfers superadmin\n\`\`\`` +
							`/drip set $token 0.1 5m - (Superadmin Only) Manages drip settings with <$token> <decimals> <1m|4h>\n\`\`\`\n` +
							`/drip settings - (Superadmin Only) Returns current drip settings\n` +
							`/drip 0xAddress $token - Drips a preset token amount to an address with <0xAddress> <$token>\n`;

						telegramText = `${helpText}`;
					/**
					 * @dev Check and manage superadmin
					 */
					case '/superadmin':
						if (params[0] === 'set' && hasSuperAdminAndRpc && isSuperAdmin && VALIDATION?.username.test(params[1])) {
							await redis.set('superadmin', params[1]);
							telegramText = `Superadmin set to \`${params[1]}\`.`;
						} else if (hasSuperAdminAndRpc && isAdmin) {
							telegramText = `Superadmin is \`${superAdmin}\`.`;
						}
						break;
					/**
					 * @dev Request faucet to drip tokens to an address
					 */
					case '/drip':
						if (
							params[0] === 'set' &&
							isSuperAdmin &&
							hasSuperAdminAndRpc &&
							VALIDATION?.token.test(params[1]) &&
							VALIDATION?.number.test(params[2]) &&
							VALIDATION?.time.test(params[3])
						) {
							const isNativeToken = params[1].toLowerCase() === rpc.token.toLowerCase();
							const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
							const token = params[1].toLowerCase();
							if (!isNativeToken && !existingTokens?.[token]) break;

							const existingDripSettings: { [key: string]: any } = (await redis.get(`drip`)) || {};
							await redis.set('drip', {
								...existingDripSettings,
								[token]: {
									quantity: params[2],
									interval: params[3],
								},
							});

							telegramText = `Drip settings for \`${token}\` set to \`${params[2]}\` every \`${params[3]}\`.`;
						} else if (params[0] === 'settings' && isSuperAdmin && hasSuperAdminAndRpc) {
							const existingDripSettings: { [key: string]: any } = (await redis.get(`drip`)) || {};
							const dripValues = Object.entries(existingDripSettings).map(
								([key, value], index) => `${index !== 0 ? '\n\n' : ''}${key.toUpperCase()}: ${value.quantity}/${value.interval}`,
							);

							telegramText = `Drip settings are:\n\`\`\`\n${dripValues.toString().replaceAll(',', '')}\n\`\`\`\n`;
						} else if (hasSuperAdminAndRpc && VALIDATION?.address.test(params[0]) && VALIDATION?.token.test(params[1])) {
							const isNativeToken = params[1].toLowerCase() === rpc.token.toLowerCase();
							const existingTokens: { [key: string]: any } = (await redis.get('tokens')) || {};
							const existingDripSettings: { [key: string]: any } = (await redis.get(`drip`)) || {};
							const token = params[1].toLowerCase();
							const tokenDripSettings = existingDripSettings?.[token];

							// Validation - If token doesn't exist don't continue
							if ((!isNativeToken && !existingTokens?.[token]) || !tokenDripSettings) {
								telegramText = `Invalid token drip request for \`${token.toUpperCase()}\`.`;
								break;
							}

							const dripQuantity = tokenDripSettings?.quantity ?? 0;
							const dripInterval: string = tokenDripSettings?.interval ?? `0m`;

							// Convert to minutes
							const dripIntervalMinutes = dripInterval.endsWith('m')
								? parseInt(dripInterval.replace('m', ''))
								: parseInt(dripInterval.replace('h', '')) * 60;

							const rateLimitUser = parseInt((await redis.get(`lastdrip/${message.from.username}/${token}`)) || '0', 0);
							const rateLimitAddress = parseInt((await redis.get(`lastdrip/${params[0].toLowerCase()}/${token}`)) || '0', 0);
							const rateLimit = rateLimitUser <= rateLimitAddress ? rateLimitUser : rateLimitAddress;
							const currentTime = new Date().getTime();
							const isRateLimitApproved = currentTime - rateLimit > dripIntervalMinutes * 60 * 1000;

							if (isRateLimitApproved) {
								const fetchURL = `https://qstash.upstash.io/v2/enqueue/${env.UPSTASH_QSTASH_QUEUE}/${env.CLOUDFLARE_WORKER_QUEUE_URL}`;
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
										amount: dripQuantity,
										token,
									}),
								});

								// Update last request made
								await redis.set(`lastdrip/${message.from.username}/${token}`, currentTime);
								await redis.set(`lastdrip/${params[0].toLowerCase()}/${token}`, currentTime);

								telegramText = `Dripping...\n\`\`\`\n${dripQuantity} ${token.toUpperCase()} to ${params[0]}\n\`\`\``;
							} else {
								telegramText = `Rate limit reached.\n\nThe current rate limit for \`${token.toUpperCase()}\` is \`${dripQuantity}\`/\`${dripInterval}\`.`;
							}
						}
						break;
					default:
					// Nothing
				}

				// Telegram message handler
				if (telegramText) {
					await telegramSendMessage({
						endpoint: '/sendMessage?parse_mode=markdown',
						chatId,
						text: telegramText,
						apiToken: env.TELEGRAM_API_TOKEN,
					});
				}
			}
		}

		// Default response
		return new Response(MESSAGES.DEFAULT.SUCCESS.text, { status: MESSAGES.DEFAULT.SUCCESS.status });
	},
} satisfies ExportedHandler<Env>;
