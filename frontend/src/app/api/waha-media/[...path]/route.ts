import { NextRequest, NextResponse } from "next/server";
import { WAHA_BASE, WAHA_API_KEY } from "@/lib/waha";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const p = await params;
    const path = p.path.join("/");
    const targetUrl = `${WAHA_BASE}/${path}${req.nextUrl.search}`;

    // Fetch the media from WAHA API with the required X-Api-Key header
    const response = await fetch(targetUrl, {
      method: "GET",
      headers: {
        "X-Api-Key": WAHA_API_KEY,
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
