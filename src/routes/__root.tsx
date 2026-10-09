import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { AuthProvider } from "@/lib/auth/provider";
import { NotFoundPage } from "@/lib/error-component";
import { getPublicSiteUrl } from "@/lib/public-site-url";
import { shop } from "@/shop-config";
import appCss from "../styles.css?url";

const title = `${shop.name} | Estilo e tradição em Lauro de Freitas`;

export const Route = createRootRoute({
  loader: () => getPublicSiteUrl(),
  head: ({ loaderData }) => {
    const siteUrl = loaderData ?? "http://127.0.0.1:8080";
    const shareImage = `${siteUrl}/og.jpg`;
    return {
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        { name: "description", content: shop.seoDescription },
        { name: "theme-color", content: "#090909" },
        { property: "og:title", content: title },
        { property: "og:description", content: shop.seoDescription },
        { property: "og:image", content: shareImage },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:type", content: "website" },
        { property: "og:locale", content: "pt_BR" },
        { property: "og:url", content: siteUrl },
        { property: "og:site_name", content: shop.name },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: shop.seoDescription },
        { name: "twitter:image", content: shareImage },
      ],
      links: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "stylesheet", href: appCss },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Outfit:wght@400;500;600&display=swap",
        },
        { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      ],
    };
  },
  notFoundComponent: NotFoundPage,
  component: () => (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthProvider>
          <Outlet />
        </AuthProvider>
        <Scripts />
      </body>
    </html>
  ),
});
