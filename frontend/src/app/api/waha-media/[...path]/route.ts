import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const p = await params;
    const path = p.path.join("/");
    // Reconstruimos la URL hacia WAHA
    // Asumimos que WAHA está en localhost:3000 o si hay variable de entorno
    const wahaBase = process.env.WAHA_URL || "http://localhost:3000";
    const targetUrl = `${wahaBase}/${path}${req.nextUrl.search}`;

    console.log("Fetching media from WAHA:", targetUrl);

    // Fetch the media from WAHA API with the required X-Api-Key header
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "X-Api-Key": process.env.WAHA_API_KEY || "virgo_secret_key",
        "Accept": "*/*",
      },
    });

    if (!response.ok) {
      console.error(`Error fetching WAHA media. Status: ${response.status} ${response.statusText}`);
      return new NextResponse(`Error fetching media: ${response.statusText}`, { status: response.status });
    }

    // Set the appropriate headers for the file
    const headers = new Headers();
    const contentType = response.headers.get("content-type");
    if (contentType) headers.set("Content-Type", contentType);
    
    // Pipe the binary data to the client
    return new NextResponse(response.body, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Error in WAHA media proxy:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
