package main

import (
	"embed"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"image-studio/backend"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wailsmac "github.com/wailsapp/wails/v2/pkg/options/mac"
	wailswindows "github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

const (
	packageVersion = "2.0.3"
	defaultE2EPort = 9230
)

type automationLaunchConfig struct {
	Enabled bool
	Only    bool
	Port    int
	Source  string
}

func main() {
	automationConfig := parseAutomationLaunchConfig(os.Args[1:], os.Getenv)
	automationStatus := automationStatusFromConfig(automationConfig)

	if automationConfig.Enabled {
		server, url, port, err := startE2EServer(assets, automationStatus)
		if err != nil {
			println("Error:", err.Error())
			return
		}
		automationStatus.ServerURL = url
		automationStatus.Port = port
		automationStatus.BridgeMethods = append([]string(nil), e2eBridgeMethods...)
		fmt.Printf("[FHL Studio E2E] %s\n", url)
		defer server.Close()

		if automationConfig.Only {
			waitForInterrupt()
			return
		}
	}

	svc := backend.NewService()
	desktopAPI := backend.NewDesktopAPI(svc)
	svc.SetAutomationStatus(automationStatus)

	appOptions := newBaseAppOptions(svc, desktopAPI)

	if runtime.GOOS == "darwin" {
		appOptions.Mac = &wailsmac.Options{
			Appearance:           wailsmac.DefaultAppearance,
			TitleBar:             wailsmac.TitleBarHiddenInset(),
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		}
	}
	if runtime.GOOS == "windows" {
		webviewUserDataPath, err := backend.WindowsWebviewUserDataPath()
		if err != nil {
			println("Error:", err.Error())
			return
		}
		legacyWebviewUserDataPaths, err := backend.WindowsLegacyWebviewUserDataPaths()
		if err != nil {
			println("Error:", err.Error())
			return
		}
		if err := backend.MigrateWindowsWebviewDataDirs(webviewUserDataPath, legacyWebviewUserDataPaths); err != nil {
			println("Warning:", err.Error())
		}
		appOptions.Windows = &wailswindows.Options{
			Theme:                wailswindows.SystemDefault,
			BackdropType:         wailswindows.Mica,
			WebviewIsTransparent: false,
			WindowIsTranslucent:  true,
			WebviewUserDataPath:  webviewUserDataPath,
			CustomTheme: &wailswindows.ThemeSettings{
				DarkModeTitleBar:           wailswindows.RGB(32, 32, 32),
				DarkModeTitleBarInactive:   wailswindows.RGB(38, 38, 38),
				DarkModeTitleText:          wailswindows.RGB(245, 245, 245),
				DarkModeTitleTextInactive:  wailswindows.RGB(200, 200, 200),
				DarkModeBorder:             wailswindows.RGB(54, 54, 54),
				DarkModeBorderInactive:     wailswindows.RGB(45, 45, 45),
				LightModeTitleBar:          wailswindows.RGB(243, 243, 243),
				LightModeTitleBarInactive:  wailswindows.RGB(237, 237, 237),
				LightModeTitleText:         wailswindows.RGB(31, 31, 31),
				LightModeTitleTextInactive: wailswindows.RGB(96, 96, 96),
				LightModeBorder:            wailswindows.RGB(219, 219, 219),
				LightModeBorderInactive:    wailswindows.RGB(226, 226, 226),
			},
		}
	}

	err := wails.Run(appOptions)

	if err != nil {
		println("Error:", err.Error())
	}
}

func newBaseAppOptions(svc *backend.Service, desktopAPI *backend.DesktopAPI) *options.App {
	return &options.App{
		Title:     "FHL Studio",
		Width:     1440,
		Height:    980,
		MinWidth:  1100,
		MinHeight: 780,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Handler:    svc.MediaHandler(http.NotFoundHandler()),
			Middleware: svc.MediaHandler,
		},
		BackgroundColour:         &options.RGBA{R: 18, G: 20, B: 26, A: 1},
		OnStartup:                svc.StartupWithPSBridge,
		OnShutdown:               svc.Shutdown,
		EnableDefaultContextMenu: true,
		Bind: []interface{}{
			desktopAPI,
		},
	}
}

func parseAutomationLaunchConfig(args []string, getenv func(string) string) automationLaunchConfig {
	config := automationLaunchConfig{
		Port: defaultE2EPort,
	}
	if truthy(getenv("IMAGE_STUDIO_E2E")) {
		config.Enabled = true
		config.Source = "env"
	}
	if truthy(getenv("IMAGE_STUDIO_E2E_ONLY")) {
		config.Enabled = true
		config.Only = true
		config.Source = "env"
	}
	if port, ok := parsePositivePort(getenv("IMAGE_STUDIO_E2E_PORT")); ok {
		config.Port = port
	}

	for i := 0; i < len(args); i++ {
		arg := strings.TrimSpace(args[i])
		switch {
		case arg == "--e2e" || arg == "--test-mode":
			config.Enabled = true
			config.Source = "argv"
		case arg == "--e2e-only" || arg == "--test-mode-only":
			config.Enabled = true
			config.Only = true
			config.Source = "argv"
		case arg == "--e2e-port" || arg == "--test-port":
			if i+1 < len(args) {
				if port, ok := parsePositivePort(args[i+1]); ok {
					config.Port = port
					i++
				}
			}
		case strings.HasPrefix(arg, "--e2e-port="):
			if port, ok := parsePositivePort(strings.TrimPrefix(arg, "--e2e-port=")); ok {
				config.Port = port
			}
		case strings.HasPrefix(arg, "--test-port="):
			if port, ok := parsePositivePort(strings.TrimPrefix(arg, "--test-port=")); ok {
				config.Port = port
			}
		}
	}
	if config.Source == "" && config.Enabled {
		config.Source = "unknown"
	}
	return config
}

func automationStatusFromConfig(config automationLaunchConfig) backend.AutomationStatus {
	executable, _ := os.Executable()
	return backend.AutomationStatus{
		Enabled:        config.Enabled,
		Mode:           config.Source,
		Port:           config.Port,
		E2EOnly:        config.Only,
		PackageVersion: packageVersion,
		PID:            os.Getpid(),
		Executable:     executable,
		StartedAt:      time.Now().UnixMilli(),
	}
}

func truthy(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes", "on", "y":
		return true
	default:
		return false
	}
}

func parsePositivePort(value string) (int, bool) {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port <= 0 || port > 65535 {
		return 0, false
	}
	return port, true
}

func waitForInterrupt() {
	ch := make(chan os.Signal, 1)
	signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
	<-ch
	signal.Stop(ch)
}

func isServerClosed(err error) bool {
	return err == nil || errors.Is(err, http.ErrServerClosed)
}
