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
		const skippedFiles = [
			'/env.json',
			'/CNAME',
			'/index.css',
			'/index.js',
			'/manifest.webmanifest',
			'/oembed.json',
		]
		const shouldRewrite = (true
			&& !skippedPathnameStarts.some(start => requestURL.pathname.startsWith(start))
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

		const embedInformation = await fetch(env.API_ORIGIN + `embed?url=${encodeURIComponent(requestURL.pathname)}`, {
			method: 'GET',
		}).then(response => response.json())
			.catch(() => undefined)

		if (!embedInformation?.data)
			return originalResponse

		let html = await originalResponse.text()

		const newEmbedHTML = (`
			<meta name="description" content="Tell your story!" />
			<meta property="og:type" content="website" />
			<meta property="og:title" content="${embedInformation.data.title}" />
			<meta property="og:description" content="${embedInformation.data.description}" />
			<meta property="og:url" content="${env.STATIC_ORIGIN}${embedInformation.data.url}" />
		`).trim().replaceAll('\t', '');

		html = html.replace(/<!-- embed start -->.*?<!-- embed end -->/s, newEmbedHTML);

		const headers = new Headers(originalResponse.headers);
		headers.set('Content-Type', originalResponse.headers.get('Content-Type') ?? 'text/html; charset=utf-8');
		headers.set('Content-Length', html.length.toString());

		return new Response(html, {
			status: originalResponse.status,
			statusText: originalResponse.statusText,
			headers,
		});
	},
};
