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
  private var reportedSecure = false        // last value emitted to JS (for flip-guarded re-emit)

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
      // Secure path. Host our content INSIDE the secure canvas via the shared heal
      // core (scrollView has no superview yet → unhealthy → it hosts). First mount
      // behaves exactly as before when the canvas IS present.
      isSecure = true
      healSecureHostingIfNeeded()
    } else {
      // Canvas not ready yet — common at off-window init, since UITextField only
      // vends its secure canvas once laid out in a window. Render normally for now
      // (NOT capture-protected) and re-derive secure state in didMoveToWindow when
      // the canvas first appears (de-latch). Keep secureField in the hierarchy so
      // that canvas can be created — do NOT remove it.
      scrollView.frame = bounds
      scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(scrollView)            // on top of the (still-empty) secureField
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

  // Relayout-free heal core. Acts ONLY when hosting is unhealthy; the healthy case
  // short-circuits after a cheap subview scan + identity checks, so it is safe to call
  // from layoutSubviews every pass. Returns whether it actually re-hosted (for logging).
  //
  // Unhealthy = ANY of: scrollView has no superview; scrollView's superview is not the
  // current live canvas; the canvas is detached from the field; the scrollView is not in
  // a window. In every healthy state none of these hold. Never calls
  // setNeedsLayout()/layoutIfNeeded() — it is invoked from layout and must not loop.
  // Never reparents the canvas out of the field — the capture exclusion stays put.
  @discardableResult
  private func healSecureHostingIfNeeded() -> Bool {
    guard isSecure else { return false }       // no-op on the insecure fallback path
    guard let canvas = findSecureCanvas() else {
      NSLog("[SecureImageView] heal: no canvas found (cannot host)")
      return false
    }

    let healthy = scrollView.superview === canvas
      && canvas.superview === secureField
      && scrollView.window != nil
    if healthy { return false }                // short-circuit: no per-frame churn/log

    // Classify the unhealthy reason for diagnosis (logged only when we actually heal).
    if scrollView.superview == nil {
      NSLog("[SecureImageView] heal: orphaned (superview==nil) -> re-hosting")
    } else if scrollView.superview !== canvas {
      NSLog("[SecureImageView] heal: orphaned (superview!==canvas) -> re-hosting")
    } else {
      NSLog("[SecureImageView] heal: same-canvas-unhealthy (canvas detached / window==nil) -> re-hosting")
    }

    canvas.subviews.forEach { $0.removeFromSuperview() }
    canvas.isUserInteractionEnabled = true
    scrollView.frame = canvas.bounds
    scrollView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    canvas.addSubview(scrollView)              // auto-removes scrollView from any prior superview
    secureCanvas = canvas
    contentHost = canvas
    return true
  }

  // iOS tears down / rebuilds the secure field's canvas across a screenshot or a
  // screen-capture (record / AirPlay) toggle — possibly more than once, with variable
  // timing — orphaning our hosted scrollView so the live image goes black. We heal on
  // a short ladder rather than a single turn, and force a repaint each step to cover
  // the "same canvas, render suppressed" case where re-hosting alone is a no-op.
  private func registerCaptureObservers() {
    screenshotObserver = NotificationCenter.default.addObserver(
      forName: UIApplication.userDidTakeScreenshotNotification,
      object: nil, queue: .main
    ) { [weak self] _ in
      NSLog("[SecureImageView] observer: userDidTakeScreenshot -> heal ladder")
      self?.scheduleCaptureHealLadder()
    }
    capturedObserver = NotificationCenter.default.addObserver(
      forName: UIScreen.capturedDidChangeNotification,
      object: nil, queue: .main
    ) { [weak self] _ in
      NSLog("[SecureImageView] observer: capturedDidChange (isCaptured=\(UIScreen.main.isCaptured)) -> heal ladder")
      self?.scheduleCaptureHealLadder()
    }
  }

  // Variable + possibly-repeated canvas rebuild → heal at a few offsets after the event.
  private func scheduleCaptureHealLadder() {
    for delay in [0.1, 0.3, 0.6] {
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.healAndRepaintForCapture()
      }
    }
  }

  // Capture path only: heal, then force a repaint regardless of whether we re-hosted.
  // The repaint handles Theory B (same canvas instance, rendering suppressed by the
  // capture) where the heal guard correctly no-ops but the layer still needs a redraw.
  // setNeedsDisplay is a display invalidation, not a layout pass — safe to call here.
  //
  // NOTE (fallback, intentionally NOT wired): if this redraw nudge proves insufficient
  // on-device for the same-canvas-suppressed case, the heavier deterministic option is
  // to force a clean canvas rebuild by toggling the secure flag —
  //   secureField.isSecureTextEntry = false; secureField.isSecureTextEntry = true
  // then re-host into the fresh canvas. That MUST be gated by `!UIScreen.main.isCaptured`
  // (never toggle during an active recording — it would open a one-frame protection gap).
  // Left as documentation only; do not enable without that guard.
  private func healAndRepaintForCapture() {
    let healed = healSecureHostingIfNeeded()
    imageView.image = imageView.image          // bounce the image to force a repaint
    secureCanvas?.setNeedsDisplay()
    scrollView.setNeedsDisplay()
    NSLog("[SecureImageView] capture heal: healed=\(healed)")
  }

  // MARK: - Layout

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil else { return }
    // De-latch: if the initial off-window setup found no canvas (isSecure == false),
    // re-derive now that we're in a window and the field can vend its canvas. This is
    // the common init-race path (blank during plain browsing, no capture involved).
    if !isSecure, findSecureCanvas() != nil {
      isSecure = true
      let healed = healSecureHostingIfNeeded()   // moves content off the insecure self-host
      emitSecureStateIfChanged()                  // flip-guarded re-emit: false -> true
      NSLog("[SecureImageView] didMoveToWindow: de-latched to secure (healed=\(healed))")
      return
    }
    let healed = healSecureHostingIfNeeded()
    NSLog("[SecureImageView] didMoveToWindow: secure=\(isSecure) healed=\(healed)")
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    // Self-heal any orphaned hosting on layout passes (rotation, zoom reset, forced
    // relayout). Guarded + relayout-free; logs only when it actually heals (no spam).
    if healSecureHostingIfNeeded() {
      NSLog("[SecureImageView] layoutSubviews: healed orphaned hosting")
    }
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
    emitSecureStateIfChanged()
  }

  // Emit the secure state to JS the first time bounds are ready, and again only if the
  // value actually flips (e.g. de-latch false -> true). Flip-guarded against spam.
  private func emitSecureStateIfChanged() {
    guard bounds.width > 0 else { return }
    if didReportState && reportedSecure == isSecure { return }
    didReportState = true
    reportedSecure = isSecure
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
