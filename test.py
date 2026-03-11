def read_log_lines(file_path):
    with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            yield line.strip()

# Usage
for log_line in read_log_lines("hewdg_2.log.txt"):
    print(log_line)