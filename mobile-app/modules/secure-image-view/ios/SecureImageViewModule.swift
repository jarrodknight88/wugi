import ExpoModulesCore

public final class SecureImageViewModule: Module {
  public func definition() -> ModuleDefinition {
    // Must match requireNativeView('SecureImageView') on the JS side.
    Name("SecureImageView")

    View(SecureImageView.self) {
      // Fires once after mount with whether capture-protection is active.
      Events("onSecureStateChange")

      Prop("uri") { (view: SecureImageView, uri: String) in
        view.setUri(uri)
      }

      Prop("maxZoomScale") { (view: SecureImageView, scale: Double?) in
        view.setMaxZoomScale(scale ?? 4.0)
      }
    }
  }
}
