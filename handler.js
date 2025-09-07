export default {
	async fetch (request, env, ctx) {
		const workerURL = new URL(request.url);

		const targetURL = new URL(workerURL.pathname + workerURL.search, env.TEST_ORIGIN);

		const originalResponse = await fetch(targetURL.toString(), {
			method: request.method,
			headers: request.headers,
			body: request.body,
			redirect: 'follow',
		});

		const contentType = originalResponse.headers.get('Content-Type');
		if (!contentType || !contentType.includes('text/html')) {
			return originalResponse;
		}

		let html = await originalResponse.text()

		const embedInformation = await fetch(env.API_ORIGIN + `embed?url=${workerURL.pathname}`, {
			method: 'GET',
		}).then(response => response.json())
			.catch(() => undefined)

		if (!embedInformation?.data) {
			return originalResponse
		}

		const newEmbedHTML =
			`<meta name="description" content="Tell your story!" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${embedInformation.data.title}" />
<meta property="og:description" content="${embedInformation.data.description}" />
<meta property="og:url" content="${env.STATIC_ORIGIN}${embedInformation.data.url}" />`;

		html = html.replace(/<!-- embed start -->.*?<!-- embed end -->/s, newEmbedHTML);

		const headers = new Headers(originalResponse.headers);
		headers.set('Content-Type', originalResponse.headers.get('Content-Type'));
		headers.set('Content-Length', html.length.toString());

		return new Response(html, {
			status: originalResponse.status,
			statusText: originalResponse.statusText,
			headers: headers,
		});
	},
};
