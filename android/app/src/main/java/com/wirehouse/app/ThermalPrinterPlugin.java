package com.wirehouse.app;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;

/**
 * Отправляет сырые ESC/POS байты на сетевой чек-принтер (XPrinter 80mm и т.п.)
 * по TCP-сокету. Принтер и устройство должны быть в одной Wi-Fi сети.
 *
 * JS-вызов:
 *   ThermalPrinter.print({ ip: "192.168.1.50", port: 9100, data: "<base64 ESC/POS>" })
 */
@CapacitorPlugin(name = "ThermalPrinter")
public class ThermalPrinterPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        final String ip = call.getString("ip");
        final int port = call.getInt("port", 9100);
        final String dataBase64 = call.getString("data");
        final int timeoutMs = call.getInt("timeout", 5000);

        if (ip == null || ip.isEmpty()) {
            call.reject("Не задан IP принтера");
            return;
        }
        if (dataBase64 == null) {
            call.reject("Нет данных для печати");
            return;
        }

        final byte[] bytes;
        try {
            bytes = Base64.decode(dataBase64, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("Некорректные данные (base64)");
            return;
        }

        new Thread(() -> {
            Socket socket = new Socket();
            try {
                socket.connect(new InetSocketAddress(ip, port), timeoutMs);
                OutputStream out = socket.getOutputStream();
                out.write(bytes);
                out.flush();
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Ошибка печати: " + e.getMessage());
            } finally {
                try { socket.close(); } catch (Exception ignored) {}
            }
        }).start();
    }
}
