import ExpoModulesCore
import UIKit

// Process-wide tiny in-memory cache. No third-party image library.
private let secureImageCache = NSCache<NSURL, UIImage>()

public final class SecureImageView: ExpoView, UIScrollViewDelegate, UITextFieldDelegate {
  // JS event: secure:true → hosted inside the capture-excluded canvas;
  // secure:false → private hierarchy not found, rendering normally (unprotected).
  private let onSecureStateChange = EventDispatcher()

  // ── Secure plumbing ──────────────────────────────────────────────────
  private let secureField = UITextField()
  private weak var secureCanvas: UIView?    // the capture-excluded layer host, if found
  private var isSecure = false
  private var didReportState = false

  // Capture-lifecycle observers. iOS tears down / rebuilds the secure field's
  // private canvas across a screenshot or screen-capture toggle, orphaning our
  // hosted scrollView (live image goes black). We re-host on these.
  private var screenshotObserver: NSObjectProtocol?
  private var capturedObserver: NSObjectProtocol?

  // ── Content ──────────────────────────────────────────────────────────
  private let scrollView = UIScrollView()
  private let imageView = UIImageView()
  private var currentURL: URL?
  private var loadTask: URLSessionDataTask?
  private var maxZoom: Double = 4.0

  // Whichever view we ended up hosting the scrollView in (canvas or self).
  private weak var contentHost: UIView?

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    setupScrollView()
    setupSecureContainer()
    registerCaptureObservers()
  }

  deinit {
    loadTask?.cancel()
    if let screenshotObserver = screenshotObserver {
      NotificationCenter.default.removeObserver(screenshotObserver)
    }
    if let capturedObserver = capturedObserver {
      NotificationCenter.default.removeObserver(capturedObserver)
    }
  }

  // MARK: - Setup

  private func setupScrollView() {
    scrollView.minimumZoomScale = 1.0
    scrollView.maximumZoomScale = CGFloat(maxZoom)
    scrollView.bouncesZoom = true
    scrollView.showsHorizontalScrollIndicator = false
    scrollView.showsVerticalScrollIndicator = false
    scrollView.delegate = self
    // Let single taps fall through to the RN responder system quickly; we add
    // NO tap recognizers natively (single/double tap stay owned by RN).
    scrollView.delaysContentTouches = false
    scrollView.canCancelContentTouches = true
    scrollView.contentInsetAdjustmentBehavior = .never

    imageView.contentMode = .scaleAspectFit
    imageView.isUserInteractionEnabled = true
    scrollView.addSubview(imageView)
  }

  private func setupSecureContainer() {
    // The field must live in the hierarchy for its secure canvas layer to exist,
    // but it must never become first responder (no keyboard) — see delegate.
    secureField.isSecureTextEntry = true
    secureField.delegate = self
    secureField.frame = bounds
    secureField.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(secureField)
    layoutIfNeeded()

    if findSecureCanvas() != nil {
      // Secure path. Host our content INSIDE the secure canvas via the shared
      // attach routine (re-used on capture lifecycle events to re-host).
      isSecure = true
      reattachSecureContent()
    } else {
      // Fallback: render normally (NOT capture-protected). Report to JS.
      secureField.removeFromSuperview()
      scrollView.frame = bounds
      scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(scrollView)
      contentHost = self
      isSecure = false
    }
  }

  // Defensively locate the private secure canvas subview. iOS 13–15 names it
  // `_UITextLayoutCanvasView`; match by class-name substring so we don't bind a
  // private symbol and tolerate renames.
  private func findSecureCanvas() -> UIView? {
    return secureField.subviews.first { subview in
      String(describing: type(of: subview)).contains("CanvasView")
    }
  }

  // Host (or re-host) our scrollView inside the secure field's canvas. Idempotent:
  // the `superview !== canvas` guard makes it a no-op when nothing was torn down,
  // and a re-attach when iOS swapped/cleared the canvas across a capture event.
  // Never reparents the canvas out of the field — the capture exclusion stays put.
  private func reattachSecureContent() {
    guard isSecure else { return }            // no-op on the insecure fallback path
    guard let canvas = findSecureCanvas() else { return }
    if scrollView.superview !== canvas {
      canvas.subviews.forEach { $0.removeFromSuperview() }
      canvas.isUserInteractionEnabled = true
      scrollView.frame = canvas.bounds
      scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      canvas.addSubview(scrollView)
      secureCanvas = canvas
      contentHost = canvas
    }
    setNeedsLayout()
    layoutIfNeeded()
  }

  // iOS tears down / rebuilds the secure field's canvas across a screenshot or a
  // screen-capture (record / AirPlay) toggle, orphaning our hosted scrollView so
  // the live image goes black. Re-host on the next runloop turn (after iOS has
  // finished rebuilding). The async defer is deliberate; if the canvas is re-found
  // too early on-device, the documented fallback is asyncAfter ~0.1s.
  private func registerCaptureObservers() {
    screenshotObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.userDidTakeScreenshotNotification,
      object: nil, queue: .main
    ) { _ in
      DispatchQueue.main.async { [weak self] in self?.reattachSecureContent() }
    }
    capturedObserver = NotificationCenter.default.addObserver(
      forName: UIScreen.capturedDidChangeNotification,
      object: nil, queue: .main
    ) { _ in
      DispatchQueue.main.async { [weak self] in self?.reattachSecureContent() }
    }
  }

  // MARK: - Layout

  public override func layoutSubviews() {
    super.layoutSubviews()
    // Keep the field (and thus its canvas) filling our bounds.
    secureField.frame = bounds
    if let host = contentHost {
      scrollView.frame = host.bounds
    }
    // Reset zoom geometry to the current bounds when not actively zoomed.
    if scrollView.zoomScale == scrollView.minimumZoomScale {
      imageView.frame = scrollView.bounds
      scrollView.contentSize = scrollView.bounds.size
    }
    reportStateIfNeeded()
  }

  private func reportStateIfNeeded() {
    guard !didReportState, bounds.width > 0 else { return }
    didReportState = true
    onSecureStateChange(["secure": isSecure])
  }

  // MARK: - Props

  func setMaxZoomScale(_ scale: Double) {
    maxZoom = max(1.0, scale)
    scrollView.maximumZoomScale = CGFloat(maxZoom)
  }

  func setUri(_ uri: String) {
    guard let url = URL(string: uri) else { return }
    if url == currentURL { return }
    currentURL = url
    loadTask?.cancel()

    // Reset zoom for the new image.
    scrollView.setZoomScale(scrollView.minimumZoomScale, animated: false)

    if let cached = secureImageCache.object(forKey: url as NSURL) {
      imageView.image = cached
      setNeedsLayout()
      return
    }

    let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, error in
      guard let self = self else { return }
      guard error == nil, let data = data, let image = UIImage(data: data) else {
        // Load error — leave the view blank (RN overlay/Buy bar still render).
        return
      }
      secureImageCache.setObject(image, forKey: url as NSURL)
      DispatchQueue.main.async {
        // Ignore if the uri changed while loading.
        guard self.currentURL == url else { return }
        self.imageView.image = image
        self.setNeedsLayout()
      }
    }
    loadTask = task
    task.resume()
  }

  // MARK: - UIScrollViewDelegate (pinch + pan only)

  public func viewForZooming(in scrollView: UIScrollView) -> UIView? {
    return imageView
  }

  public func scrollViewDidZoom(_ scrollView: UIScrollView) {
    // Keep the image centered while zoomed/zooming out.
    let bounds = scrollView.bounds.size
    let content = scrollView.contentSize
    let offsetX = max((bounds.width - content.width) * 0.5, 0)
    let offsetY = max((bounds.height - content.height) * 0.5, 0)
    imageView.center = CGPoint(
      x: content.width * 0.5 + offsetX,
      y: content.height * 0.5 + offsetY
    )
  }

  // MARK: - UITextFieldDelegate

  // Never allow the secure field to begin editing → no keyboard, ever. The field
  // exists solely to vend its capture-excluded canvas layer.
  public func textFieldShouldBeginEditing(_ textField: UITextField) -> Bool {
    return false
  }
}
