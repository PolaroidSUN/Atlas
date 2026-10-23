use serde_json::{json, Value};
use std::{collections::HashSet, fs, path::PathBuf, sync::Mutex};

// Preserve save ordering when autosave requests arrive close together.
static SAVE_LOCK: Mutex<()> = Mutex::new(());
use tauri::{AppHandle, Manager};

fn workspace_root(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Não foi possível localizar a pasta de dados do Atlas: {error}"))?
        .join("workspace");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("Não foi possível preparar a pasta de dados do Atlas: {error}"))?;
    Ok(directory)
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_' || character == '-')
}

fn read_json_recover(path: &PathBuf) -> Option<Value> {
    for candidate in [path.clone(), PathBuf::from(format!("{}.bak", path.display()))] {
        if let Ok(contents) = fs::read_to_string(candidate) {
            if let Ok(value) = serde_json::from_str::<Value>(&contents) {
                return Some(value);
            }
        }
    }
    None
}

fn atomic_write_json(path: &PathBuf, value: &Value) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", std::process::id()));
    let backup = PathBuf::from(format!("{}.bak", path.display()));
    let serialized = serde_json::to_vec_pretty(value)
        .map_err(|error| format!("Não foi possível serializar os dados: {error}"))?;
    fs::write(&temp, serialized)
        .map_err(|error| format!("Não foi possível gravar um arquivo temporário: {error}"))?;
    if path.exists() {
        let _ = fs::remove_file(&backup);
        fs::rename(path, &backup)
            .map_err(|error| format!("Não foi possível preservar o arquivo anterior: {error}"))?;
    }
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        if backup.exists() {
            let _ = fs::rename(&backup, path);
        }
        return Err(format!("Não foi possível finalizar o salvamento: {error}"));
    }
    let _ = fs::remove_file(backup);
    Ok(())
}

fn load_items_from(root: &PathBuf) -> Vec<Value> {
    let manifest_path = root.join("index.json");
    let manifest = read_json_recover(&manifest_path).unwrap_or_else(|| json!({"formatVersion":1,"ids":[]}));
    let ids = manifest.get("ids").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut items = Vec::new();
    for raw_id in ids {
        let Some(id) = raw_id.as_str() else { continue };
        if !valid_id(id) { continue; }
        if let Some(item) = read_json_recover(&root.join(format!("{id}.json"))) {
            if item.get("id").and_then(Value::as_str) == Some(id) {
                items.push(item);
            }
        }
    }
    items
}

#[tauri::command]
fn load_workspace(app: AppHandle) -> Result<Value, String> {
    let root = workspace_root(&app)?;
    Ok(json!({ "formatVersion": 1, "items": load_items_from(&root) }))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChanges {
    upserts: Vec<Value>,
    deleted_ids: Vec<String>,
}

#[tauri::command]
fn save_workspace(app: AppHandle, changes: WorkspaceChanges) -> Result<Value, String> {
    let _guard = SAVE_LOCK
        .lock()
        .map_err(|_| "O mecanismo de salvamento está indisponível.".to_owned())?;
    if changes.upserts.len() > 10_000 || changes.deleted_ids.len() > 10_000 {
        return Err("O lote de alterações ultrapassa o limite permitido.".into());
    }
    let root = workspace_root(&app)?;
    let mut ids: HashSet<String> = read_json_recover(&root.join("index.json"))
        .and_then(|manifest| manifest.get("ids").and_then(Value::as_array).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .filter(|id| valid_id(id))
        .collect();

    let mut saved = 0usize;
    for item in changes.upserts {
        let id = item.get("id").and_then(Value::as_str).ok_or("Um item não possui identificador válido.")?;
        let item_type = item.get("type").and_then(Value::as_str).ok_or("Um item não possui tipo válido.")?;
        if !valid_id(id) || !["canvas", "doc", "folder", "image"].contains(&item_type) {
            return Err("Um item contém identificador ou tipo inválido.".into());
        }
        atomic_write_json(&root.join(format!("{id}.json")), &item)?;
        ids.insert(id.to_owned());
        saved += 1;
    }

    let mut deleted = 0usize;
    for id in changes.deleted_ids {
        if !valid_id(&id) { continue; }
        ids.remove(&id);
        let _ = fs::remove_file(root.join(format!("{id}.json")));
        let _ = fs::remove_file(root.join(format!("{id}.json.bak")));
        deleted += 1;
    }

    let manifest = json!({ "formatVersion": 1, "ids": ids.into_iter().collect::<Vec<_>>() });
    atomic_write_json(&root.join("index.json"), &manifest)?;
    Ok(json!({ "saved": saved, "deleted": deleted }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_workspace, save_workspace])
        .run(tauri::generate_context!())
        .expect("falha ao iniciar Atlas");
}
