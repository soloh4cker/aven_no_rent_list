using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace DaysInn.AvenNoRent
{
    public sealed class GuestRecord
    {
        public string id { get; set; }
        public string firstName { get; set; }
        public string lastName { get; set; }
        public string reason { get; set; }
        public string confirmationNumber { get; set; }
        public string createdAt { get; set; }
        public string updatedAt { get; set; }
    }

    public sealed class HostRequest
    {
        public string command { get; set; }
        public List<GuestRecord> guests { get; set; }
    }

    public sealed class HostConfig
    {
        public string dataPath { get; set; }
        public string managerSid { get; set; }
        public string managerAccount { get; set; }
    }

    public sealed class DatabaseFile
    {
        public string format { get; set; }
        public int version { get; set; }
        public string lastUpdatedUtc { get; set; }
        public List<GuestRecord> guests { get; set; }
    }

    public sealed class HostResponse
    {
        public bool ok { get; set; }
        public string error { get; set; }
        public List<GuestRecord> guests { get; set; }
        public bool canWrite { get; set; }
        public string dataPath { get; set; }
        public string managerAccount { get; set; }
        public string hostVersion { get; set; }
        public string lastUpdatedUtc { get; set; }
    }

    internal static class Program
    {
        private const string HostVersion = "2.0.0";
        private const int MaximumIncomingMessageBytes = 1024 * 1024;
        private const int MaximumGuestRecords = 10000;
        private static readonly UTF8Encoding Utf8NoBom = new UTF8Encoding(false);
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer
        {
            MaxJsonLength = MaximumIncomingMessageBytes
        };

        private static HostConfig _config;

        public static int Main(string[] args)
        {
            try
            {
                string hostDirectory = AppDomain.CurrentDomain.BaseDirectory;
                string configPath = Path.Combine(hostDirectory, "config.json");
                _config = LoadConfig(configPath);

                Stream input = Console.OpenStandardInput();
                Stream output = Console.OpenStandardOutput();

                while (true)
                {
                    string incomingJson = ReadNativeMessage(input);
                    if (incomingJson == null)
                    {
                        break;
                    }

                    HostResponse response;
                    try
                    {
                        HostRequest request = Json.Deserialize<HostRequest>(incomingJson) ?? new HostRequest();
                        response = HandleRequest(request);
                    }
                    catch (Exception ex)
                    {
                        response = ErrorResponse("Invalid request: " + ex.Message);
                    }

                    WriteNativeMessage(output, Json.Serialize(response));
                }

                return 0;
            }
            catch (Exception ex)
            {
                try
                {
                    Console.Error.WriteLine("Aven No-Rent native host failed: " + ex);
                }
                catch
                {
                }
                return 1;
            }
        }

        private static HostConfig LoadConfig(string configPath)
        {
            if (!File.Exists(configPath))
            {
                throw new FileNotFoundException("Native host configuration was not found.", configPath);
            }

            HostConfig config = Json.Deserialize<HostConfig>(File.ReadAllText(configPath, Encoding.UTF8));
            if (config == null || String.IsNullOrWhiteSpace(config.dataPath) || String.IsNullOrWhiteSpace(config.managerSid))
            {
                throw new InvalidDataException("Native host configuration is incomplete.");
            }

            config.dataPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(config.dataPath));
            config.managerSid = config.managerSid.Trim();
            config.managerAccount = Clean(config.managerAccount, 200);
            return config;
        }

        private static HostResponse HandleRequest(HostRequest request)
        {
            string command = Clean(request.command, 50).ToLowerInvariant();
            bool canWrite = IsManagerAccount();

            if (command == "status" || command == "getlist")
            {
                DatabaseFile database = ReadDatabase();
                return SuccessResponse(database, canWrite);
            }

            if (command == "replacelist")
            {
                if (!canWrite)
                {
                    return ErrorResponse("This Windows account has read-only access. Only the manager account can modify the shared list.");
                }

                List<GuestRecord> cleanedGuests = ValidateAndCleanGuests(request.guests);
                DatabaseFile database = new DatabaseFile
                {
                    format = "aven-no-rent-shared-list",
                    version = 2,
                    lastUpdatedUtc = DateTime.UtcNow.ToString("o"),
                    guests = cleanedGuests
                };

                WriteDatabase(database);
                return SuccessResponse(database, true);
            }

            return ErrorResponse("Unknown native-host command.");
        }

        private static bool IsManagerAccount()
        {
            try
            {
                WindowsIdentity identity = WindowsIdentity.GetCurrent();
                string currentSid = identity.User == null ? String.Empty : identity.User.Value;
                return String.Equals(currentSid, _config.managerSid, StringComparison.OrdinalIgnoreCase);
            }
            catch
            {
                return false;
            }
        }

        private static DatabaseFile ReadDatabase()
        {
            if (!File.Exists(_config.dataPath))
            {
                return NewEmptyDatabase();
            }

            string json = File.ReadAllText(_config.dataPath, Encoding.UTF8);
            if (String.IsNullOrWhiteSpace(json))
            {
                return NewEmptyDatabase();
            }

            DatabaseFile database = Json.Deserialize<DatabaseFile>(json);
            if (database == null)
            {
                throw new InvalidDataException("The shared no-rent file is invalid.");
            }

            database.format = String.IsNullOrWhiteSpace(database.format)
                ? "aven-no-rent-shared-list"
                : database.format;
            database.version = database.version <= 0 ? 2 : database.version;
            database.lastUpdatedUtc = Clean(database.lastUpdatedUtc, 80);
            database.guests = ValidateAndCleanGuests(database.guests);
            return database;
        }

        private static DatabaseFile NewEmptyDatabase()
        {
            return new DatabaseFile
            {
                format = "aven-no-rent-shared-list",
                version = 2,
                lastUpdatedUtc = String.Empty,
                guests = new List<GuestRecord>()
            };
        }

        private static List<GuestRecord> ValidateAndCleanGuests(List<GuestRecord> source)
        {
            source = source ?? new List<GuestRecord>();
            if (source.Count > MaximumGuestRecords)
            {
                throw new InvalidDataException("The shared list contains too many guest records.");
            }

            List<GuestRecord> result = new List<GuestRecord>();
            foreach (GuestRecord item in source)
            {
                if (item == null)
                {
                    continue;
                }

                string firstName = Clean(item.firstName, 80);
                string lastName = Clean(item.lastName, 80);
                if (String.IsNullOrWhiteSpace(firstName) || String.IsNullOrWhiteSpace(lastName))
                {
                    throw new InvalidDataException("Every guest record must contain a first name and last name.");
                }

                result.Add(new GuestRecord
                {
                    id = String.IsNullOrWhiteSpace(Clean(item.id, 100))
                        ? Guid.NewGuid().ToString("D")
                        : Clean(item.id, 100),
                    firstName = firstName,
                    lastName = lastName,
                    reason = Clean(item.reason, 500),
                    confirmationNumber = Clean(item.confirmationNumber, 100),
                    createdAt = Clean(item.createdAt, 80),
                    updatedAt = Clean(item.updatedAt, 80)
                });
            }

            result.Sort(delegate(GuestRecord left, GuestRecord right)
            {
                int byLast = StringComparer.CurrentCultureIgnoreCase.Compare(left.lastName, right.lastName);
                return byLast != 0
                    ? byLast
                    : StringComparer.CurrentCultureIgnoreCase.Compare(left.firstName, right.firstName);
            });

            return result;
        }

        private static void WriteDatabase(DatabaseFile database)
        {
            string directory = Path.GetDirectoryName(_config.dataPath);
            if (String.IsNullOrWhiteSpace(directory))
            {
                throw new InvalidOperationException("The configured data path has no directory.");
            }

            Directory.CreateDirectory(directory);
            string lockPath = Path.Combine(directory, "no-rent-list.lock");

            using (FileStream lockStream = AcquireWriteLock(lockPath))
            {
                string temporaryPath = _config.dataPath + ".tmp." + Process.GetCurrentProcess().Id;
                try
                {
                    File.WriteAllText(temporaryPath, Json.Serialize(database), Utf8NoBom);

                    if (File.Exists(_config.dataPath))
                    {
                        try
                        {
                            File.Replace(temporaryPath, _config.dataPath, null, true);
                        }
                        catch
                        {
                            File.Copy(temporaryPath, _config.dataPath, true);
                            File.Delete(temporaryPath);
                        }
                    }
                    else
                    {
                        File.Move(temporaryPath, _config.dataPath);
                    }
                }
                finally
                {
                    if (File.Exists(temporaryPath))
                    {
                        try { File.Delete(temporaryPath); } catch { }
                    }
                }
            }
        }

        private static FileStream AcquireWriteLock(string lockPath)
        {
            Exception lastError = null;
            for (int attempt = 0; attempt < 20; attempt++)
            {
                try
                {
                    return new FileStream(lockPath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
                }
                catch (IOException ex)
                {
                    lastError = ex;
                    Thread.Sleep(100);
                }
            }

            throw new IOException("The shared list is busy. Please try again.", lastError);
        }

        private static HostResponse SuccessResponse(DatabaseFile database, bool canWrite)
        {
            return new HostResponse
            {
                ok = true,
                error = String.Empty,
                guests = database.guests ?? new List<GuestRecord>(),
                canWrite = canWrite,
                dataPath = _config.dataPath,
                managerAccount = _config.managerAccount,
                hostVersion = HostVersion,
                lastUpdatedUtc = database.lastUpdatedUtc ?? String.Empty
            };
        }

        private static HostResponse ErrorResponse(string message)
        {
            DatabaseFile database;
            try
            {
                database = ReadDatabase();
            }
            catch
            {
                database = NewEmptyDatabase();
            }

            return new HostResponse
            {
                ok = false,
                error = message ?? "Unknown native-host error.",
                guests = database.guests,
                canWrite = IsManagerAccount(),
                dataPath = _config == null ? String.Empty : _config.dataPath,
                managerAccount = _config == null ? String.Empty : _config.managerAccount,
                hostVersion = HostVersion,
                lastUpdatedUtc = database.lastUpdatedUtc ?? String.Empty
            };
        }

        private static string Clean(string value, int maximumLength)
        {
            string cleaned = Regex.Replace(value ?? String.Empty, "\\s+", " ").Trim();
            return cleaned.Length <= maximumLength
                ? cleaned
                : cleaned.Substring(0, maximumLength);
        }

        private static string ReadNativeMessage(Stream input)
        {
            byte[] lengthBytes = ReadExactly(input, 4);
            if (lengthBytes == null)
            {
                return null;
            }

            int length = BitConverter.ToInt32(lengthBytes, 0);
            if (length < 0 || length > MaximumIncomingMessageBytes)
            {
                throw new InvalidDataException("Native message length is invalid.");
            }

            byte[] payload = ReadExactly(input, length);
            if (payload == null)
            {
                throw new EndOfStreamException("Native message ended unexpectedly.");
            }

            return Encoding.UTF8.GetString(payload);
        }

        private static byte[] ReadExactly(Stream input, int count)
        {
            byte[] buffer = new byte[count];
            int offset = 0;

            while (offset < count)
            {
                int read = input.Read(buffer, offset, count - offset);
                if (read == 0)
                {
                    return offset == 0 ? null : buffer;
                }
                offset += read;
            }

            return buffer;
        }

        private static void WriteNativeMessage(Stream output, string json)
        {
            byte[] payload = Encoding.UTF8.GetBytes(json ?? "{}");
            byte[] length = BitConverter.GetBytes(payload.Length);
            output.Write(length, 0, length.Length);
            output.Write(payload, 0, payload.Length);
            output.Flush();
        }
    }
}
