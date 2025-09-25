export default {
	/**
	 * @param {Request} request
	 * @param {Record<string, any>} env
	 * @param {ExecutionContext} ctx
	 */
	async fetch (request, env, ctx) {
		if (request.method !== 'GET')
			return fetch(request);

		const requestURL = new URL(request.url);

		const skippedPathnameStarts = [
			'/image/',
			'/font/',
			'/style/',
			'/lang/',
			'/beta/',
			'/js/',
		]
		const skippedPathnameEnds = [
			'.css',
			'.js',
		]
		const skippedFiles = [
			'/env.json',
			'/CNAME',
			'/manifest.webmanifest',
			'/oembed.json',
		]
		const shouldRewrite = (true
			&& !skippedPathnameStarts.some(start => requestURL.pathname.startsWith(start))
			&& !skippedPathnameEnds.some(end => requestURL.pathname.endsWith(end))
			&& !skippedFiles.includes(requestURL.pathname)
		)

		const rewrittenPathname = shouldRewrite ? '/' : requestURL.pathname;
		const targetURL = new URL(rewrittenPathname + requestURL.search, env.STATIC_ORIGIN);

		const requestHeaders = new Headers(request.headers);
		if (shouldRewrite) {
			requestHeaders.delete('If-None-Match');
			requestHeaders.delete('If-Modified-Since');
		}

		const rawResponse = await fetch(targetURL.toString(), {
			method: request.method,
			headers: requestHeaders,
			body: request.body,
			redirect: 'follow',
		});

		const contentType = rawResponse.headers.get('Content-Type');
		if (!contentType || !contentType.includes('text/html'))
			return rawResponse;

		const cache = caches.default;

		const cachedInjected = await cache.match(request.url).catch(() => null);
		if (cachedInjected)
			return cachedInjected;

		/**
		 * @typedef {Object} EmbedProperty
		 * @property {'name' | 'property'} type
		 * @property {string} name
		 * @property {string} content
		 */

		const newEmbedProperties = await fetch(env.API_ORIGIN + `/embed?url=${encodeURIComponent(requestURL.pathname)}`)
			.then(response => response.json())
			.catch(() => undefined)
			.then(json => /** @type {EmbedProperty[] | undefined} */ (json?.data))

		if (!Array.isArray(newEmbedProperties) || !newEmbedProperties.length)
			return rawResponse

		/** 
		 * @param {string} str 
		 * @returns {string}
		 */
		function escapeHTMLAttributeValue (str) {
			return str
				.replaceAll('&', '&amp;')
				.replaceAll('"', '&quot;')
				.replaceAll("'", '&#x27;')
				.replaceAll('<', '&lt;')
				.replaceAll('>', '&gt;')
				.replaceAll('\xa0', '&nbsp;')
				.replaceAll('\n', '&NewLine;')
		}

		let newEmbedHTML = newEmbedProperties.map(prop => {
			if (prop.type !== 'name' && prop.type !== 'property')
				return ''

			return `<meta ${prop.type}="${escapeHTMLAttributeValue(prop.name)}" content="${escapeHTMLAttributeValue(prop.content)}" />`
		}).join('\n\t\t')

		const canonicalURL = newEmbedProperties.find(p => (p.type === 'property' && p.name === 'og:url'))?.content
		const title = newEmbedProperties.find(p => (p.type === 'property' && p.name === 'og:title'))?.content

		if (canonicalURL) {
			const oembedEndpoint = escapeHTMLAttributeValue(`https://api.fluff4.me/oembed?url=${encodeURIComponent(canonicalURL)}`)
			newEmbedHTML += `\n\t\t<link rel="alternate" type="application/json+oembed" href="${oembedEndpoint}"${title ? ` title="${title}"` : ''} />`
		}

		let html = await rawResponse.text()
		html = html.replace(/<!-- embed start -->.*?<!-- embed end -->/s, newEmbedHTML);

		const responseHeaders = new Headers(rawResponse.headers);
		responseHeaders.set('Content-Type', rawResponse.headers.get('Content-Type') ?? 'text/html; charset=utf-8');
		responseHeaders.set('Content-Length', html.length.toString());

		responseHeaders.set('Cache-Control', 'public, s-maxage=300'); // 5 minute cache
		responseHeaders.set('Cache-Tag', 'embed-injected');

		const response = new Response(html, {
			status: rawResponse.status === 304 ? 200 : rawResponse.status,
			statusText: rawResponse.status === 304 ? 'OK' : rawResponse.statusText,
			headers: responseHeaders,
		});

		ctx.waitUntil(cache.put(request.url, response.clone()).catch(() => { }));
		return response;
	},
};
