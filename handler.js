export default {
	async fetch (request, env, ctx) {
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
		const originalResponse = await fetch(targetURL.toString(), {
			method: request.method,
			headers: request.headers,
			body: request.body,
			redirect: 'follow',
		});

		const contentType = originalResponse.headers.get('Content-Type');
		if (!contentType || !contentType.includes('text/html'))
			return originalResponse;

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
			return originalResponse

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

		let html = await originalResponse.text()
		html = html.replace(/<!-- embed start -->.*?<!-- embed end -->/s, newEmbedHTML);

		const headers = new Headers(originalResponse.headers);
		headers.set('Content-Type', originalResponse.headers.get('Content-Type') ?? 'text/html; charset=utf-8');
		headers.set('Content-Length', html.length.toString());

		headers.set('Cache-Control', 'public, s-maxage=300'); // 5 minute cache
		headers.set('Cache-Tag', 'embed-injected');

		return new Response(html, {
			status: originalResponse.status === 304 ? 200 : originalResponse.status,
			statusText: originalResponse.status === 304 ? 'OK' : originalResponse.statusText,
			headers,
		});
	},
};
