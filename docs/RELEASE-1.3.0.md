## Echo 1.3.0

New: a YouTube tab. Videos downloaded from YouTube with yt-dlp now get their own tab instead of ending up in Movies. Echo finds them in your video folders by the name yt-dlp gives them ("Title [id].mp4"), or when they're in a folder called YouTube.

If you download with `--embed-metadata --embed-thumbnail`, Echo shows the real thumbnail, the channel and the upload date. Otherwise it uses the file name and grabs a frame from the video. MP4 plays right in the app; WebM and MKV open in Elmedia Player. This is the command I use:

```
yt-dlp -t mp4 --embed-metadata --embed-thumbnail -o "~/Movies/YouTube/%(title)s [%(id)s].%(ext)s" URL
```

Newest videos come first, you can search by title or channel, and a video you started picks up where you left off.

Nothing changed in how your files are handled. Your library, playlists and playback positions are all still there.

- Mac with Apple silicon (arm64)
- macOS 14 Sonoma or later
- Download: `Echo-1.3-macOS-arm64.zip`
- SHA-256: see the attached `Echo-1.3-macOS-arm64.zip.sha256` file

This build is signed ad hoc, without a Developer ID or Apple notarization. Only download it from this repo and check the SHA-256 before opening it. The first time, right-click the app and choose Open.
